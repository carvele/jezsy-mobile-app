#!/usr/bin/env python3
"""
verify_persona_rls.py - Durable, Fixture-Safe Persona RLS Verification Test Harness.

Implements the multi-persona verification architecture approved in Phase B6:
  Layer 1: Catalog & Schema Governance Verification
    - Validates 100% of public tables have Row Level Security enabled (rowsecurity = true).
    - Validates all SECURITY DEFINER functions have explicitly pinned search_path.
    - Validates execute privileges on sensitive RPCs (increment_wear_count, create_reservation_multi_idempotent).
  Layer 2: Fixture-Safe Runtime Persona Probes
    - Anon Persona: Asserts public read on catalog, read-denial on private tables,
      and execution-denial on mutating/command RPCs.
    - Customer Persona: Asserts authenticated access to own profile/measurements,
      denial on other-user private rows, fail-closed enforcement on direct table writes,
      and safe verification of command RPC boundaries with zero residual state.
    - Staff Persona: Asserts operational manager/inventory read access,
      and fail-closed denial on owner-only administrative tables (announcements).
"""

import os
import sys
import json
import uuid
import urllib.request
import urllib.error
from pathlib import Path

def load_env():
    """Load environment variables from .env file if present."""
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

load_env()

SUPABASE_URL = os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

HARNESS_CUSTOMER_EMAIL = os.environ.get("HARNESS_CUSTOMER_EMAIL", "test_harness_customer@jezsy.internal")
HARNESS_CUSTOMER_PASSWORD = os.environ.get("HARNESS_CUSTOMER_PASSWORD", "VerifyPersonaTest123!")

HARNESS_STAFF_EMAIL = os.environ.get("HARNESS_STAFF_EMAIL", "test_harness_staff@jezsy.internal")
HARNESS_STAFF_PASSWORD = os.environ.get("HARNESS_STAFF_PASSWORD", "VerifyStaffTest123!")

class PersonaHarness:
    def __init__(self, url: str, anon_key: str, service_key: str = ""):
        self.url = url.rstrip("/")
        self.anon_key = anon_key
        self.service_key = service_key
        self.results = []

    def log_result(self, layer: str, persona: str, test_name: str, status: str, detail: str = ""):
        self.results.append({
            "layer": layer,
            "persona": persona,
            "test": test_name,
            "status": status,
            "detail": detail
        })
        print(f"[{status}] {layer} | {persona} | {test_name}{': ' + detail if detail else ''}")

    def login_persona(self, email: str, password: str):
        """Authenticate via GoTrue password endpoint and return (access_token, user_id)."""
        auth_url = f"{self.url}/auth/v1/token?grant_type=password"
        headers = {
            "apikey": self.anon_key,
            "Content-Type": "application/json"
        }
        data = json.dumps({"email": email, "password": password}).encode("utf-8")
        req = urllib.request.Request(auth_url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return body.get("access_token"), body.get("user", {}).get("id")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            print(f"Auth error for {email} (HTTP {e.code}): {err_body}")
            return None, None
        except Exception as e:
            print(f"Auth connection error for {email}: {e}")
            return None, None

    def rest_request(self, endpoint: str, key: str, method: str = "GET", payload: dict = None, headers: dict = None):
        """Execute REST call against PostgREST endpoint."""
        url = f"{self.url}/rest/v1/{endpoint.lstrip('/')}"
        req_headers = {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        if headers:
            req_headers.update(headers)

        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                status_code = resp.getcode()
                body = resp.read().decode("utf-8")
                return status_code, json.loads(body) if body else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                parsed_err = json.loads(err_body)
            except Exception:
                parsed_err = err_body
            return e.code, parsed_err
        except Exception as e:
            return 0, str(e)

    # -- Layer 1: Catalog & Schema Checks -------------------------

    def run_catalog_checks(self, sql_executor=None):
        """
        Verify catalog security properties.
        If sql_executor callable is provided, executes directly against database.
        When omitted, catalog checks are recorded as DEFERRED rather than PASS.
        """
        print("\n=== LAYER 1: Catalog & Governance Verification ===")

        if sql_executor:
            try:
                # Check 1.1: Verify increment_wear_count anon privilege check
                anon_priv_sql = "SELECT has_function_privilege('anon', 'public.increment_wear_count(uuid)'::regprocedure, 'EXECUTE') as has_priv;"
                rows = sql_executor(anon_priv_sql)
                has_anon_priv = rows[0].get("has_priv", True) if rows else True
                status_1_1 = "PASS" if not has_anon_priv else "FAIL"
                self.log_result(
                    "Layer 1", "anon",
                    "increment_wear_count anon execute revoked",
                    status_1_1,
                    "Privilege revoked (Secure)" if not has_anon_priv else "B6-GRANT-LEAK-001 active: anon still has EXECUTE"
                )

                # Check 1.2: Verify increment_wear_count authenticated privilege check
                auth_priv_sql = "SELECT has_function_privilege('authenticated', 'public.increment_wear_count(uuid)'::regprocedure, 'EXECUTE') as has_priv;"
                rows_auth = sql_executor(auth_priv_sql)
                has_auth_priv = rows_auth[0].get("has_priv", False) if rows_auth else False
                status_1_2 = "PASS" if has_auth_priv else "FAIL"
                self.log_result(
                    "Layer 1", "authenticated",
                    "increment_wear_count authenticated execute granted",
                    status_1_2,
                    "Authenticated users can call RPC" if has_auth_priv else "Authenticated missing EXECUTE"
                )

                # Check 1.3: Verify 100% RLS on public tables
                rls_sql = "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';"
                table_rows = sql_executor(rls_sql)
                non_rls = [r["tablename"] for r in table_rows if not r.get("rowsecurity", False)]
                status_1_3 = "PASS" if len(non_rls) == 0 else "FAIL"
                self.log_result(
                    "Layer 1", "system",
                    "100% public tables under RLS",
                    status_1_3,
                    f"All {len(table_rows)} tables under RLS" if not non_rls else f"Non-RLS tables: {non_rls}"
                )

                # Check 1.4: Verify SECURITY DEFINER search_path pinning
                secdef_sql = """
                SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args, p.proconfig
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.prosecdef = true;
                """
                secdef_rows = sql_executor(secdef_sql)
                unpinned = [r["proname"] for r in secdef_rows if not r.get("proconfig") or not any("search_path=" in c for c in (r["proconfig"] or []))]
                status_1_4 = "PASS" if len(unpinned) == 0 else "FAIL"
                self.log_result(
                    "Layer 1", "system",
                    "SECURITY DEFINER search_path pinned",
                    status_1_4,
                    f"All {len(secdef_rows)} SECURITY DEFINER functions have pinned search_path" if not unpinned else f"Unpinned: {unpinned}"
                )
            except Exception as e:
                self.log_result("Layer 1", "system", "Catalog query execution", "FAIL", str(e))
        else:
            self.log_result(
                "Layer 1", "system",
                "Direct catalog SQL probe",
                "DEFERRED",
                "Deferred to direct database runner (non-REST catalog probe)"
            )

    # -- Layer 2: Representative Runtime Persona Probes -----------

    def run_runtime_probes(self):
        """Execute representative fixture-safe runtime probes across Anon, Customer, and Staff."""
        print("\n=== LAYER 2: Runtime Persona Probes ===")

        if not self.url or not self.anon_key:
            print("Warning: Supabase URL or Anon key not set. Skipping live REST probes.")
            return

        # =========================================================
        # 1. Anon Persona Probes
        # =========================================================
        print("\n--- Persona: Anonymous Client ---")

        # Probe 2.1: Anon reading public catalog (products)
        code, body = self.rest_request("products?select=id,name&limit=1", self.anon_key)
        passed_2_1 = (code == 200 and isinstance(body, list))
        self.log_result(
            "Layer 2", "anon",
            "Public catalog read access",
            "PASS" if passed_2_1 else "FAIL",
            f"HTTP {code} - Catalog readable"
        )

        # Probe 2.2: Anon reading private table (user_measurements)
        code, body = self.rest_request("user_measurements?select=id&limit=1", self.anon_key)
        is_measurements_blocked = (code in (401, 403)) or (code == 200 and isinstance(body, list) and len(body) == 0)
        self.log_result(
            "Layer 2", "anon",
            "Private table user_measurements read denial",
            "PASS" if is_measurements_blocked else "FAIL",
            f"HTTP {code} - Rows returned: {len(body) if isinstance(body, list) else 'blocked'}"
        )

        # Probe 2.3: Anon reading devices table
        code, body = self.rest_request("devices?select=*&limit=1", self.anon_key)
        is_devices_blocked = (code in (401, 403)) or (code == 200 and isinstance(body, list) and len(body) == 0)
        self.log_result(
            "Layer 2", "anon",
            "Private table devices read denial",
            "PASS" if is_devices_blocked else "FAIL",
            f"HTTP {code} - Rows returned: {len(body) if isinstance(body, list) else 'blocked'}"
        )

        # Probe 2.4: Anon attempting to execute increment_wear_count RPC
        dummy_item_id = str(uuid.uuid4())
        code, body = self.rest_request(
            "rpc/increment_wear_count",
            self.anon_key,
            method="POST",
            payload={"p_item_id": dummy_item_id}
        )
        body_str = json.dumps(body) if isinstance(body, (dict, list)) else str(body)
        is_wear_denied = (code in (401, 403, 404)) or ("permission denied" in body_str.lower())
        detail_wear = body.get("message") if isinstance(body, dict) else body_str[:80]
        if not is_wear_denied and "not owned by caller" in body_str:
            detail_wear = f"B6-GRANT-LEAK-001 active: anon executed RPC (HTTP {code}: {detail_wear})"

        self.log_result(
            "Layer 2", "anon",
            "increment_wear_count anonymous execution denial",
            "PASS" if is_wear_denied else "FAIL",
            f"HTTP {code} - {detail_wear}"
        )

        # Probe 2.5: Anon attempting to execute create_reservation_multi_idempotent RPC
        code, body = self.rest_request(
            "rpc/create_reservation_multi_idempotent",
            self.anon_key,
            method="POST",
            payload={
                "_idempotency_key": str(uuid.uuid4()),
                "_items": [],
                "_date": "2026-10-01",
                "_appointment_time": "10:00:00"
            }
        )
        body_str = json.dumps(body) if isinstance(body, (dict, list)) else str(body)
        is_res_denied = (code in (401, 403, 404)) or ("permission denied" in body_str.lower())
        detail_res = body.get("message") if isinstance(body, dict) else body_str[:80]
        self.log_result(
            "Layer 2", "anon",
            "create_reservation_multi_idempotent anonymous execution denial",
            "PASS" if is_res_denied else "FAIL",
            f"HTTP {code} - {detail_res}"
        )

        # =========================================================
        # 2. Customer Persona Probes (Authenticated Token)
        # =========================================================
        print("\n--- Persona: Authenticated Customer ---")
        cust_token, cust_id = self.login_persona(HARNESS_CUSTOMER_EMAIL, HARNESS_CUSTOMER_PASSWORD)
        if not cust_token:
            self.log_result(
                "Layer 2", "customer",
                "Customer authentication",
                "FAIL",
                f"Failed to authenticate {HARNESS_CUSTOMER_EMAIL}"
            )
            return

        # Probe 2.6: Customer reading own profile
        code, body = self.rest_request(f"profiles?id=eq.{cust_id}&select=id,email,role", cust_token)
        passed_2_6 = (code == 200 and isinstance(body, list) and len(body) == 1 and body[0].get("id") == cust_id)
        self.log_result(
            "Layer 2", "customer",
            "Own profile read access",
            "PASS" if passed_2_6 else "FAIL",
            f"HTTP {code} - Retrieved own profile record"
        )

        # Probe 2.7: Customer updating profile and measurements via RPC
        code, body = self.rest_request(
            "rpc/update_profile_and_measurements",
            cust_token,
            method="POST",
            payload={
                "_fit_preference": "Regular",
                "_height": 175,
                "_weight": 70
            }
        )
        passed_2_7 = (code == 200 and isinstance(body, dict) and body.get("success") is True)
        self.log_result(
            "Layer 2", "customer",
            "Own profile and measurement RPC update",
            "PASS" if passed_2_7 else "FAIL",
            f"HTTP {code} - Profile and measurements updated successfully"
        )

        # Probe 2.8: Customer reading other user's private measurements
        staff_token, staff_id = self.login_persona(HARNESS_STAFF_EMAIL, HARNESS_STAFF_PASSWORD)
        target_other_id = staff_id or str(uuid.uuid4())
        code, body = self.rest_request(f"user_measurements?user_id=eq.{target_other_id}&select=*", cust_token)
        is_other_denied = (code in (401, 403)) or (code == 200 and isinstance(body, list) and len(body) == 0)
        self.log_result(
            "Layer 2", "customer",
            "Other-user private row read denial",
            "PASS" if is_other_denied else "FAIL",
            f"HTTP {code} - Rows visible: {len(body) if isinstance(body, list) else 'denied'}"
        )

        # Probe 2.9: Customer direct table write to reservations fails closed
        code, body = self.rest_request(
            "reservations",
            cust_token,
            method="POST",
            payload={
                "id": str(uuid.uuid4()),
                "customer_id": cust_id,
                "status": "Pending"
            }
        )
        is_direct_write_blocked = (code in (401, 403))
        body_msg = body.get("message") if isinstance(body, dict) else str(body)[:80]
        self.log_result(
            "Layer 2", "customer",
            "Direct table write to reservations fails closed",
            "PASS" if is_direct_write_blocked else "FAIL",
            f"HTTP {code} - {body_msg}"
        )

        # Probe 2.10: Customer reservation command execution probe
        # Exercises create_reservation_multi_idempotent with empty items to verify execute grant and parameter validation with zero residual state
        code, body = self.rest_request(
            "rpc/create_reservation_multi_idempotent",
            cust_token,
            method="POST",
            payload={
                "_idempotency_key": str(uuid.uuid4()),
                "_items": [],
                "_date": "2026-10-01",
                "_appointment_time": "10:00:00"
            }
        )
        body_msg = body.get("message") if isinstance(body, dict) else str(body)
        passed_2_10 = (code == 400 and "at least one item" in body_msg)
        self.log_result(
            "Layer 2", "customer",
            "Reservation command authorization verified safely (zero residual state)",
            "PASS" if passed_2_10 else "FAIL",
            f"HTTP {code} - Execution authorized, validated cleanly ({body_msg})"
        )

        # =========================================================
        # 3. Staff Persona Probes (Authenticated Token)
        # =========================================================
        print("\n--- Persona: Authenticated Staff ---")
        if not staff_token:
            self.log_result(
                "Layer 2", "staff",
                "Staff authentication",
                "FAIL",
                f"Failed to authenticate {HARNESS_STAFF_EMAIL}"
            )
            return

        # Probe 2.11: Representative staff manager/inventory access
        code, body = self.rest_request(
            "inventory?select=id,product_doc_id,size,color,total,available,reserved&limit=1",
            staff_token
        )
        passed_2_11 = (code == 200 and isinstance(body, list) and len(body) > 0)
        self.log_result(
            "Layer 2", "staff",
            "Representative inventory manager read access",
            "PASS" if passed_2_11 else "FAIL",
            f"HTTP {code} - Retrieved inventory variant stock records"
        )

        # Probe 2.12: Staff owner-only action denial (announcements mutation)
        code, body = self.rest_request(
            "announcements",
            staff_token,
            method="POST",
            payload={
                "title": "Harness Probe Announcement",
                "body": "Prohibited staff write probe",
                "type": "info"
            }
        )
        is_owner_denied = (code in (401, 403))
        body_msg = body.get("message") if isinstance(body, dict) else str(body)[:80]
        self.log_result(
            "Layer 2", "staff",
            "Owner-only action denial (announcements mutation)",
            "PASS" if is_owner_denied else "FAIL",
            f"HTTP {code} - {body_msg}"
        )

    def print_summary(self):
        print("\n" + "=" * 60)
        print("PERSONA RLS & PRIVILEGE VERIFICATION SUMMARY")
        print("=" * 60)
        total = len(self.results)
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = sum(1 for r in self.results if r["status"] == "FAIL")
        deferred = sum(1 for r in self.results if r["status"] == "DEFERRED")

        for r in self.results:
            if r["status"] == "PASS":
                status_symbol = "[+]"
            elif r["status"] == "FAIL":
                status_symbol = "[-]"
            else:
                status_symbol = "[*]"
            print(f"  {status_symbol} [{r['status']}] {r['layer']} | {r['persona']} | {r['test']}")
            if r["detail"]:
                print(f"      L-- {r['detail']}")

        print("-" * 60)
        print(f"Total: {total} | Passed: {passed} | Failed: {failed} | Deferred: {deferred}")
        print("=" * 60 + "\n")
        return failed == 0 and passed > 0

def main():
    harness = PersonaHarness(SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
    harness.run_catalog_checks()
    harness.run_runtime_probes()
    success = harness.print_summary()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
