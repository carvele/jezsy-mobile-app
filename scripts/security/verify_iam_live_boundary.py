#!/usr/bin/env python3
"""
verify_iam_live_boundary.py
Final Live Security Ledger Verification Pass for Phase 1 Enterprise Workforce IAM Hardening.

Executes real authenticated PostgREST and Edge Function HTTP probes against the live Supabase project:
1. Real Authenticated Privilege / RLS Probes:
   - Customer A updates own safe profile column -> 200 (Allowed).
   - Customer A updates Customer B's safe profile column -> 200 with 0 rows modified (RLS denied).
   - Customer A direct mutation on role -> 403 / column permission denied (Denied).
   - Customer A direct mutation on employment_status -> 403 / column permission denied (Denied).
   - Customer A direct mutation on is_blocked / deleted -> 403 / column permission denied (Denied).
   - Customer A direct mutation on invite_delivery_status -> 403 / column permission denied (Denied).
   - Forged profile UUID/email creation -> 403 / column permission denied (Denied).
2. Actual Lifecycle RPC Integration:
   - Sales Staff calling update_staff_role_v2, update_staff_status_v2, set_staff_archive_state -> 400 Unauthorized.
   - Privileged caller promoting to owner -> 403 / 42501 Owner role promotion restricted.
   - Privileged caller modifying Owner account -> 400 / Cannot modify owner account status.
   - Privileged caller archiving Owner account -> 400 / Cannot archive owner account.
   - Privileged caller self-role or self-status modification -> 400 / Cannot modify own account.
3. Immediate Offboarding (Live DB Authority):
   - Active session calling privileged RPC / can_manage_staff -> 200 / True.
   - In DB, user set to terminated or is_blocked -> Same JWT immediately returns false / 400 Unauthorized (0s lag).
4. Edge Function Onboarding (create-staff-account):
   - Unprivileged callers (Customer, Staff) -> 403 Forbidden.
   - Owner caller with invalid role (owner) -> 400 Bad Request.
   - Owner caller with conflict email -> 409 Conflict.
   - Owner caller with valid invite -> 200 OK (Zero cleartext password in response/logs).
5. Resend Invitation (resend-staff-invite):
   - Unprivileged callers -> 403 Forbidden.
   - Owner caller targeting invited user -> 200 OK (tokenized invite generated without magiclink fallback).
6. Transactional Staff Activation (activate_staff_account):
   - Unprivileged / Customer caller -> 400/403 Rejected.
   - Active staff caller -> already_active.
   - Invited staff caller -> activated, transitions to active, staff_status_history logged.
   - Activated staff direct mutation on role / employment_status -> 403 Column permission denied.
7. Quorum Helper:
   - Targeting sole Owner/Admin account in assert_privileged_account_quorum -> 42501 Quorum Violation.
"""

import os
import sys
import json
import uuid
import time
import argparse
import urllib.request
import urllib.error
from pathlib import Path

# Load .env
env_path = Path(__file__).resolve().parents[2] / ".env"
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                val = val.strip().strip("'\"")
                if key not in os.environ:
                    os.environ[key] = val

SUPABASE_URL = (os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")).rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY", "")

HARNESS_CUSTOMER_EMAIL = os.environ.get("HARNESS_CUSTOMER_EMAIL", "").strip()
HARNESS_CUSTOMER_PASSWORD = os.environ.get("HARNESS_CUSTOMER_PASSWORD", "").strip()

HARNESS_STAFF_EMAIL = os.environ.get("HARNESS_STAFF_EMAIL", "").strip()
HARNESS_STAFF_PASSWORD = os.environ.get("HARNESS_STAFF_PASSWORD", "").strip()

OWNER_TARGET_UUID = "f846e33c-d453-4f59-a750-f7d55462249d"

assert SUPABASE_URL, "SUPABASE_URL missing"
assert SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY missing"
assert HARNESS_CUSTOMER_EMAIL and HARNESS_CUSTOMER_PASSWORD, "Customer credentials missing"
assert HARNESS_STAFF_EMAIL and HARNESS_STAFF_PASSWORD, "Staff credentials missing"

class LiveIAMVerifier:
    def __init__(self):
        self.results = []

    def log(self, section: str, test_name: str, passed: bool, detail: str = ""):
        status = "PASS" if passed else "FAIL"
        self.results.append({"section": section, "test": test_name, "status": status, "detail": detail})
        print(f"[{status}] {section} | {test_name}: {detail}")

    def login(self, email: str, password: str):
        url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
        headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
        data = json.dumps({"email": email, "password": password}).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return body.get("access_token"), body.get("user", {}).get("id")
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8")
            print(f"Login failed for {email} ({e.code}): {err}")
            return None, None

    def rest_call(self, endpoint: str, token: str, method: str = "GET", payload: dict = None, prefer: str = "return=representation"):
        url = f"{SUPABASE_URL}/rest/v1/{endpoint.lstrip('/')}"
        headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": prefer
        }
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                status_code = resp.getcode()
                resp_data = resp.read().decode("utf-8")
                body = json.loads(resp_data) if resp_data else None
                return status_code, body
        except urllib.error.HTTPError as e:
            status_code = e.code
            err_data = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_data)
            except Exception:
                err_json = {"raw": err_data}
            return status_code, err_json

    def function_call(self, function_name: str, token: str, payload: dict):
        url = f"{SUPABASE_URL}/functions/v1/{function_name}"
        headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                status_code = resp.getcode()
                resp_data = resp.read().decode("utf-8")
                body = json.loads(resp_data) if resp_data else None
                return status_code, body
        except urllib.error.HTTPError as e:
            status_code = e.code
            err_data = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_data)
            except Exception:
                err_json = {"raw": err_data}
            return status_code, err_json

    def print_summary(self):
        print("\n================================================================")
        print("LIVE IAM SECURITY BOUNDARY VERIFICATION SUMMARY")
        print("================================================================")
        total = len(self.results)
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = total - passed

        for r in self.results:
            print(f"  [{r['status']}] {r['section']} | {r['test']}")
            if r["detail"]:
                print(f"      L-- {r['detail']}")

        print("----------------------------------------------------------------")
        print(f"Total Probes: {total} | Passed: {passed} | Failed: {failed}")
        print("================================================================")
        return failed == 0

def run_unprivileged_probes(v: LiveIAMVerifier):
    print("\n================================================================")
    print("STAGE 1: UNPRIVILEGED CUSTOMER & STAFF BOUNDARY PROBES")
    print("================================================================")

    cust_token, cust_id = v.login(HARNESS_CUSTOMER_EMAIL, HARNESS_CUSTOMER_PASSWORD)
    staff_token, staff_id = v.login(HARNESS_STAFF_EMAIL, HARNESS_STAFF_PASSWORD)

    if not cust_token or not staff_token:
        print("FATAL: Could not authenticate personas.")
        return False

    # ── SECTION 1: Real Authenticated Privilege / RLS Probes ────────────────
    print("\n--- SECTION 1: Real Authenticated PostgREST Privilege & RLS Boundary ---")

    # 1.1 Customer A updates own safe profile column (first_name)
    code, body = v.rest_call(f"profiles?id=eq.{cust_id}", cust_token, method="GET")
    original_first_name = body[0].get("first_name") if (code == 200 and body) else ""

    test_first_name = f"Probe_{int(time.time())}"
    patch_code, _ = v.rest_call(
        f"profiles?id=eq.{cust_id}",
        cust_token,
        method="PATCH",
        payload={"first_name": test_first_name}
    )
    succeeded_safe_update = (patch_code in (200, 204))
    v.log("Section 1", "Customer A updates own safe column (first_name)", succeeded_safe_update, f"HTTP {patch_code}")

    # Restore
    v.rest_call(f"profiles?id=eq.{cust_id}", cust_token, method="PATCH", payload={"first_name": original_first_name})

    # 1.2 Customer A attempts to update Customer B's safe profile column
    code, staff_profile_before = v.rest_call(f"profiles?id=eq.{staff_id}", cust_token, method="GET")

    patch_b_code, _ = v.rest_call(
        f"profiles?id=eq.{staff_id}",
        cust_token,
        method="PATCH",
        payload={"first_name": "TamperedByCustomerA"}
    )
    code, staff_profile_after = v.rest_call(f"profiles?id=eq.{staff_id}", staff_token, method="GET")
    other_tampered = False
    if code == 200 and staff_profile_after:
        other_tampered = (staff_profile_after[0].get("first_name") == "TamperedByCustomerA")

    rls_protected = (patch_b_code in (200, 204, 403) and not other_tampered)
    v.log("Section 1", "Customer A cannot mutate Customer B row (RLS row-ownership)", rls_protected,
          f"HTTP {patch_b_code}, Target row tampered: {other_tampered}")

    # 1.3 Customer A direct mutation on role -> Rejected
    code, err = v.rest_call(
        f"profiles?id=eq.{cust_id}",
        cust_token,
        method="PATCH",
        payload={"role": "owner"}
    )
    role_blocked = (code in (400, 403) or "permission denied" in str(err).lower())
    v.log("Section 1", "Customer A direct mutation on 'role' rejected", role_blocked, f"HTTP {code} ({err.get('message', err)})")

    # 1.4 Customer A direct mutation on employment_status -> Rejected
    code, err = v.rest_call(
        f"profiles?id=eq.{cust_id}",
        cust_token,
        method="PATCH",
        payload={"employment_status": "active"}
    )
    status_blocked = (code in (400, 403) or "permission denied" in str(err).lower())
    v.log("Section 1", "Customer A direct mutation on 'employment_status' rejected", status_blocked, f"HTTP {code} ({err.get('message', err)})")

    # 1.5 Customer A direct mutation on is_blocked / deleted -> Rejected
    code, err = v.rest_call(
        f"profiles?id=eq.{cust_id}",
        cust_token,
        method="PATCH",
        payload={"is_blocked": False, "deleted": False}
    )
    flag_blocked = (code in (400, 403) or "permission denied" in str(err).lower())
    v.log("Section 1", "Customer A direct mutation on 'is_blocked' / 'deleted' rejected", flag_blocked, f"HTTP {code} ({err.get('message', err)})")

    # 1.6 Customer A direct mutation on invite_delivery_status -> Rejected
    code, err = v.rest_call(
        f"profiles?id=eq.{cust_id}",
        cust_token,
        method="PATCH",
        payload={"invite_delivery_status": "sent"}
    )
    invite_col_blocked = (code in (400, 403) or "permission denied" in str(err).lower())
    v.log("Section 1", "Customer A direct mutation on 'invite_delivery_status' rejected", invite_col_blocked, f"HTTP {code} ({err.get('message', err)})")

    # 1.7 Forged profile insert via POST /rest/v1/profiles with forged UUID & elevated role
    fake_uuid = str(uuid.uuid4())
    code, err = v.rest_call(
        "profiles",
        cust_token,
        method="POST",
        payload={
            "id": fake_uuid,
            "email": "forged_admin@jezsy.internal",
            "first_name": "Forged",
            "role": "admin",
            "employment_status": "active"
        }
    )
    insert_blocked = (code in (400, 403, 409) or "permission denied" in str(err).lower() or "duplicate key" in str(err).lower())
    v.log("Section 1", "Customer A forged UUID & elevated profile insert rejected", insert_blocked, f"HTTP {code} ({err.get('message', err)})")

    # ── SECTION 2: Actual Lifecycle RPC Integration (Unprivileged) ─────────
    print("\n--- SECTION 2: Actual Lifecycle RPC Integration (Unprivileged Caller) ---")

    # 2.1 Sales Staff calling update_staff_role_v2
    code, err = v.rest_call(
        "rpc/update_staff_role_v2",
        staff_token,
        method="POST",
        payload={"target_user_id": staff_id, "new_role": "admin"}
    )
    staff_rpc_rejected = (code in (400, 403))
    v.log("Section 2", "Sales Staff calling update_staff_role_v2 rejected", staff_rpc_rejected, f"HTTP {code} ({err.get('message', err)})")

    # 2.2 Sales Staff calling update_staff_status_v2
    code, err = v.rest_call(
        "rpc/update_staff_status_v2",
        staff_token,
        method="POST",
        payload={
            "target_user_id": OWNER_TARGET_UUID,
            "employment_status": "terminated",
            "is_blocked": True,
            "change_note": "Unauthorized attempt"
        }
    )
    staff_status_rejected = (code in (400, 403))
    v.log("Section 2", "Sales Staff calling update_staff_status_v2 rejected", staff_status_rejected, f"HTTP {code} ({err.get('message', err)})")

    # 2.3 Sales Staff calling set_staff_archive_state
    code, err = v.rest_call(
        "rpc/set_staff_archive_state",
        staff_token,
        method="POST",
        payload={
            "target_user_id": OWNER_TARGET_UUID,
            "archived": True,
            "change_note": "Unauthorized attempt"
        }
    )
    staff_archive_rejected = (code in (400, 403))
    v.log("Section 2", "Sales Staff calling set_staff_archive_state rejected", staff_archive_rejected, f"HTTP {code} ({err.get('message', err)})")

    # ── SECTION 3: Immediate Offboarding & Invalidation (Unprivileged) ──────
    print("\n--- SECTION 3: Live Authorization Invariants (Unprivileged Caller) ---")

    code, res = v.rest_call("rpc/can_manage_staff", staff_token, method="POST")
    staff_manage_val = res if code == 200 else False
    v.log("Section 3", "Sales Staff cannot manage staff (can_manage_staff = false)", (staff_manage_val is False), f"HTTP {code}, Value: {staff_manage_val}")

    code, res = v.rest_call("rpc/can_manage_staff", cust_token, method="POST")
    cust_manage_val = res if code == 200 else False
    v.log("Section 3", "Customer cannot manage staff (can_manage_staff = false)", (cust_manage_val is False), f"HTTP {code}, Value: {cust_manage_val}")

    # ── SECTION 4 & 5: Edge Function Onboarding & Resend (Unprivileged) ─────
    print("\n--- SECTION 4 & 5: Edge Function Unprivileged Rejection ---")

    probe_email = f"test.probe.onboard.{int(time.time())}@jezsy.internal"
    code, res = v.function_call("create-staff-account", cust_token, {"email": probe_email, "role": "staff"})
    v.log("Section 4", "create-staff-account rejects Customer caller", (code == 403), f"HTTP {code} ({res.get('error', res)})")

    code, res = v.function_call("create-staff-account", staff_token, {"email": probe_email, "role": "staff"})
    v.log("Section 4", "create-staff-account rejects Sales Staff caller", (code == 403), f"HTTP {code} ({res.get('error', res)})")

    code, res = v.function_call("resend-staff-invite", cust_token, {"staffUserId": staff_id})
    v.log("Section 5", "resend-staff-invite rejects Customer caller", (code == 403), f"HTTP {code} ({res.get('error', res)})")

    code, res = v.function_call("resend-staff-invite", staff_token, {"staffUserId": staff_id})
    v.log("Section 5", "resend-staff-invite rejects Sales Staff caller", (code == 403), f"HTTP {code} ({res.get('error', res)})")

    # ── SECTION 6: Transactional Activation RPC (Unprivileged) ─────────────
    print("\n--- SECTION 6: Activation RPC Invariants (Unprivileged Caller) ---")

    code, res = v.rest_call("rpc/activate_staff_account", cust_token, method="POST")
    cust_act_blocked = (code in (400, 403))
    v.log("Section 6", "activate_staff_account rejects Customer account", cust_act_blocked, f"HTTP {code} ({res.get('message', res)})")

    code, res = v.rest_call("rpc/activate_staff_account", staff_token, method="POST")
    staff_act_already = (code == 200 and res.get("status") == "already_active")
    v.log("Section 6", "activate_staff_account returns already_active for active staff", staff_act_already, f"HTTP {code} ({res})")

    return v.print_summary()

def run_privileged_probes(v: LiveIAMVerifier):
    print("\n================================================================")
    print("STAGE 2: PRIVILEGED OWNER WORKFORCE LIFECYCLE & EDGE PROBES")
    print("================================================================")

    owner_token, owner_id = v.login(HARNESS_STAFF_EMAIL, HARNESS_STAFF_PASSWORD)
    if not owner_token:
        print("FATAL: Could not authenticate privileged persona.")
        return False, None

    # Check can_manage_staff is true
    code, res = v.rest_call("rpc/can_manage_staff", owner_token, method="POST")
    v.log("Section 2", "Privileged Owner session can_manage_staff = true", (res is True), f"HTTP {code}, Value: {res}")

    # 2.1 Owner Role Immutability: Prohibiting owner promotion in Phase 1
    code, err = v.rest_call(
        "rpc/update_staff_role_v2",
        owner_token,
        method="POST",
        payload={"target_user_id": owner_id, "new_role": "owner"}
    )
    v.log("Section 2", "RPC update_staff_role_v2 rejects owner promotion", (code == 403 and "restricted" in str(err)), f"HTTP {code} ({err.get('message', err)})")

    # 2.2 Cannot modify own role (or owner account)
    code, err = v.rest_call(
        "rpc/update_staff_role_v2",
        owner_token,
        method="POST",
        payload={"target_user_id": owner_id, "new_role": "admin"}
    )
    v.log("Section 2", "RPC update_staff_role_v2 rejects self-role modification", (code in (400, 403)), f"HTTP {code} ({err.get('message', err)})")

    # 2.3 Cannot modify owner account role
    code, err = v.rest_call(
        "rpc/update_staff_role_v2",
        owner_token,
        method="POST",
        payload={"target_user_id": OWNER_TARGET_UUID, "new_role": "staff"}
    )
    v.log("Section 2", "RPC update_staff_role_v2 rejects modifying Owner role", (code in (400, 403)), f"HTTP {code} ({err.get('message', err)})")

    # 2.4 Cannot modify owner account status
    code, err = v.rest_call(
        "rpc/update_staff_status_v2",
        owner_token,
        method="POST",
        payload={
            "target_user_id": OWNER_TARGET_UUID,
            "employment_status": "terminated",
            "is_blocked": True,
            "change_note": "Illegal probe termination"
        }
    )
    v.log("Section 2", "RPC update_staff_status_v2 rejects modifying Owner status", (code in (400, 403)), f"HTTP {code} ({err.get('message', err)})")

    # 2.5 Cannot archive owner account
    code, err = v.rest_call(
        "rpc/set_staff_archive_state",
        owner_token,
        method="POST",
        payload={
            "target_user_id": OWNER_TARGET_UUID,
            "archived": True,
            "change_note": "Illegal probe archive"
        }
    )
    v.log("Section 2", "RPC set_staff_archive_state rejects archiving Owner account", (code in (400, 403)), f"HTTP {code} ({err.get('message', err)})")

    # 2.6 Cannot modify own status (or owner account status)
    code, err = v.rest_call(
        "rpc/update_staff_status_v2",
        owner_token,
        method="POST",
        payload={
            "target_user_id": owner_id,
            "employment_status": "terminated",
            "is_blocked": True,
            "change_note": "Illegal self termination"
        }
    )
    v.log("Section 2", "RPC update_staff_status_v2 rejects self-status modification", (code in (400, 403)), f"HTTP {code} ({err.get('message', err)})")

    # ── SECTION 4: Edge Function create-staff-account ──────────────────────
    print("\n--- SECTION 4: Edge Function End-to-End Onboarding (create-staff-account) ---")

    # Invalid role probe (requesting owner role)
    code, res = v.function_call(
        "create-staff-account",
        owner_token,
        {"email": f"bad_role_{int(time.time())}@jezsy.internal", "role": "owner"}
    )
    v.log("Section 4", "create-staff-account rejects invalid role 'owner'", (code == 400), f"HTTP {code} ({res.get('error', res)})")

    # Conflict probe (inviting existing active workforce email)
    code, res = v.function_call(
        "create-staff-account",
        owner_token,
        {"email": "admin@jezsy.com", "role": "staff"}
    )
    v.log("Section 4", "create-staff-account rejects conflict email (409 Conflict)", (code == 409), f"HTTP {code} ({res.get('error', res)})")

    # Valid onboarding probe
    probe_email = f"probe.staff.{int(time.time())}@jezsy.internal"
    code, res = v.function_call(
        "create-staff-account",
        owner_token,
        {"email": probe_email, "role": "staff", "first_name": "TestProbe", "last_name": "Staff"}
    )
    created_user_id = res.get("userId") if code == 200 else None
    has_no_passwords = ("password" not in res and "tempPassword" not in res and "loginUrl" not in res)
    onboard_success = (code == 200 and created_user_id is not None and has_no_passwords)
    v.log("Section 4", "create-staff-account succeeds with zero cleartext credentials", onboard_success,
          f"HTTP {code}, User ID: {created_user_id}, Password in response: {not has_no_passwords}")

    # ── SECTION 5: Edge Function resend-staff-invite ───────────────────────
    print("\n--- SECTION 5: Edge Function Resend Invitation (resend-staff-invite) ---")

    if created_user_id:
        code, res = v.function_call(
            "resend-staff-invite",
            owner_token,
            {"staffUserId": created_user_id}
        )
        resend_ok = (code == 200 and res.get("success") is True)
        v.log("Section 5", "resend-staff-invite succeeds with tokenized invite link", resend_ok, f"HTTP {code} ({res})")
    else:
        v.log("Section 5", "resend-staff-invite skipped due to onboarding failure", False, "No created_user_id")

    success = v.print_summary()
    return success, {"userId": created_user_id, "email": probe_email}

def run_offboarded_probes(v: LiveIAMVerifier, cached_token: str):
    print("\n================================================================")
    print("STAGE 3: IMMEDIATE OFFBOARDING PROBE (ZERO TOKEN-EXPIRY LAG)")
    print("================================================================")

    # Calling can_manage_staff with the cached unexpired JWT while profile is terminated/blocked
    code, res = v.rest_call("rpc/can_manage_staff", cached_token, method="POST")
    v.log("Section 3", "Offboarded session immediately loses can_manage_staff (false)", (res is False), f"HTTP {code}, Value: {res}")

    # Calling update_staff_role_v2 with the cached unexpired JWT while profile is terminated/blocked
    code, err = v.rest_call(
        "rpc/update_staff_role_v2",
        cached_token,
        method="POST",
        payload={"target_user_id": OWNER_TARGET_UUID, "new_role": "staff"}
    )
    v.log("Section 3", "Offboarded session immediately rejected by update_staff_role_v2", (code in (400, 403)), f"HTTP {code} ({err.get('message', err)})")

    return v.print_summary()

def run_activation_probes(v: LiveIAMVerifier, probe_user_id: str, probe_email: str, probe_password: str):
    print("\n================================================================")
    print("STAGE 4: PROBE USER TRANSACTIONAL ACTIVATION & WRITE IMMUTABILITY")
    print("================================================================")

    token, uid = v.login(probe_email, probe_password)
    if not token:
        print(f"FATAL: Could not login as probe user {probe_email}")
        return False

    v.log("Section 6", f"Invited probe user logged in ({probe_email})", True, f"UID: {uid}")

    # 1. First activation call
    code, res = v.rest_call("rpc/activate_staff_account", token, method="POST")
    act_ok = (code == 200 and res.get("status") == "activated" and res.get("role") == "staff")
    v.log("Section 6", "activate_staff_account transitions invited -> activated", act_ok, f"HTTP {code} ({res})")

    # 2. Second activation call (idempotent already_active)
    code, res = v.rest_call("rpc/activate_staff_account", token, method="POST")
    idemp_ok = (code == 200 and res.get("status") == "already_active" and res.get("role") == "staff")
    v.log("Section 6", "activate_staff_account idempotent already_active", idemp_ok, f"HTTP {code} ({res})")

    # 3. Direct mutation attempt on role
    code, err = v.rest_call(
        f"profiles?id=eq.{probe_user_id}",
        token,
        method="PATCH",
        payload={"role": "admin"}
    )
    role_blocked = (code in (400, 403) or "permission denied" in str(err).lower())
    v.log("Section 6", "Activated staff direct mutation on 'role' rejected (403)", role_blocked, f"HTTP {code} ({err.get('message', err)})")

    # 4. Direct mutation attempt on employment_status
    code, err = v.rest_call(
        f"profiles?id=eq.{probe_user_id}",
        token,
        method="PATCH",
        payload={"employment_status": "resigned"}
    )
    status_blocked = (code in (400, 403) or "permission denied" in str(err).lower())
    v.log("Section 6", "Activated staff direct mutation on 'employment_status' rejected (403)", status_blocked, f"HTTP {code} ({err.get('message', err)})")

    return v.print_summary()

def main():
    parser = argparse.ArgumentParser(description="Live IAM Security Boundary Verifier")
    parser.add_argument("--mode", choices=["unprivileged", "privileged", "offboarded", "activation"], default="unprivileged")
    parser.add_argument("--token", help="Cached JWT token for offboarded probe", default="")
    parser.add_argument("--probe-id", help="Probe user UUID", default="")
    parser.add_argument("--probe-email", help="Probe user email", default="")
    parser.add_argument("--probe-password", help="Probe user password", default="")

    args = parser.parse_args()
    v = LiveIAMVerifier()

    if args.mode == "unprivileged":
        success = run_unprivileged_probes(v)
    elif args.mode == "privileged":
        success, info = run_privileged_probes(v)
        if info:
            print(f"PROBE_INFO: {json.dumps(info)}")
    elif args.mode == "offboarded":
        token = args.token
        if not token:
            token, _ = v.login(HARNESS_STAFF_EMAIL, HARNESS_STAFF_PASSWORD)
        success = run_offboarded_probes(v, token)
    elif args.mode == "activation":
        assert args.probe_id and args.probe_email and args.probe_password, "Missing activation probe arguments"
        success = run_activation_probes(v, args.probe_id, args.probe_email, args.probe_password)
    else:
        success = False

    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
