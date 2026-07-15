import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Edge Function triggered via Supabase Database Webhooks
// Trigger configured on `reservations` table (UPDATE) and `orders` table (UPDATE)

serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, table, record, old_record } = payload;

    // Only process UPDATE events
    if (type !== "UPDATE") return new Response("Ok", { status: 200 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let userId = null;
    let title = "";
    let body = "";
    let notifType = "system";

    if (table === "reservations" && record.status !== old_record.status) {
      userId = record.customer_id;
      title = `Reservation ${record.status}`;
      body = `Your reservation for ${record.product_name} is now ${record.status}.`;
      notifType = "reservation";
    } 
    else if (table === "orders" && record.status !== old_record.status) {
      userId = record.customer_id;
      title = `Order Update`;
      body = `Your order ${record.display_id} is now ${record.status}.`;
      notifType = "order";
    }
    else {
      return new Response("No relevant changes", { status: 200 });
    }

    if (!userId) return new Response("No user ID", { status: 200 });

    // 1. Insert In-App Notification
    await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      title,
      body,
      type: notifType,
    });

    // 2. Fetch User's Push Token
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("expo_push_token")
      .eq("id", userId)
      .single();

    if (profile?.expo_push_token) {
      // 3. Send Expo Push Notification
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: profile.expo_push_token,
          sound: "default",
          title,
          body,
          data: { table, id: record.id },
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
