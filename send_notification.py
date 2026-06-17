import json
import os
import sys

from supabase import create_client
from pywebpush import webpush, WebPushException

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")

SUPABASE_TABLE = "subscriptions"


def require_env(name, value):
    """Controleer of een vereiste environment variable is ingesteld."""
    if not value:
        print(f"Error: {name} environment variable not set.")
        exit(1)


def get_data_from_row(row):
    data = row.get("data")
    if not data or not isinstance(data, dict):
        return None
    if "endpoint" in data and "keys" in data:
        return {"endpoint": data["endpoint"], "keys": data["keys"]}
    print(f"Invalid subscription data for id={row['id']}: {data}")
    return None


def fetch_all_subscriptions(supabase):
    response = (
        supabase.table(SUPABASE_TABLE)
        .select("*")
        .execute()
    )

    return response.data


def remove_subscription_by_id(supabase, sub_id):
    supabase.table(SUPABASE_TABLE).delete().eq("id", sub_id).execute()


def main():
    required_envs = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_KEY": SUPABASE_KEY,
        "VAPID_PUBLIC_KEY": VAPID_PUBLIC_KEY,
        "VAPID_PRIVATE_KEY": VAPID_PRIVATE_KEY,
    }
    for name, value in required_envs.items():
        require_env(name, value)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    rows = fetch_all_subscriptions(supabase)

    sent = skipped = removed = failed = 0

    for row in rows:
        subscription_data = get_data_from_row(row)
        if not subscription_data:
            skipped += 1
            continue
        try:
            webpush(
                subscription_info=subscription_data,
                data=json.dumps({
                    "title": "Nieuwe melding",
                    "body": "Dit is een testmelding.",
                    "url": "/",
                }),
                vapid_private_key=VAPID_PRIVATE_KEY,
            )
            sent += 1
        except WebPushException as e:
            status_code = e.response.status_code if e.response is not None else None
            if status_code == 410:
                remove_subscription_by_id(supabase, row["id"])
                removed += 1
            else:
                failed += 1
                print(f"Push mislukt voor id={row['id']}: {e}", file=sys.stderr)

    print(f"Klaar. Totaal={len(rows)}, verzonden={sent}, verwijderd_410={removed}, overgeslagen={skipped}, gefaald={failed}")


if __name__ == "__main__":
    main()
