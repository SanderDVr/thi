import json
import os
import sys

from supabase import create_client
from pywebpush import webpush, WebPushException


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT")

SUPABASE_TABLE = "subscriptions"


def require_env(name, value):
    """Controleer of een vereiste environment variable is ingesteld."""
    print(f"[require_env] checking {name}")
    if not value:
        print(f"Error: {name} environment variable not set.")
        exit(1)
    print(f"[require_env] {name} is set")


def get_data_from_row(row):
    print(f"[get_data_from_row] row id={row.get('id')}")
    data = row.get("data")
    if not data or not isinstance(data, dict):
        print(f"[get_data_from_row] row id={row.get('id')} has no usable data")
        return None
    if "endpoint" in data and "keys" in data:
        print(f"[get_data_from_row] row id={row.get('id')} looks valid")
        return {"endpoint": data["endpoint"], "keys": data["keys"]}
    print(f"Invalid subscription data for id={row['id']}: {data}")
    return None


def fetch_all_subscriptions(supabase):
    print("[fetch_all_subscriptions] querying Supabase")
    response = (
        supabase.table(SUPABASE_TABLE)
        .select("*")
        .execute()
    )

    print(f"[fetch_all_subscriptions] received {len(response.data)} rows")
    return response.data


def remove_subscription_by_id(supabase, sub_id):
    print(f"[remove_subscription_by_id] deleting stale subscription id={sub_id}")
    supabase.table(SUPABASE_TABLE).delete().eq("id", sub_id).execute()


def main():
    print("[main] start")

    with open("docs/data/leeuwarden.json", "r") as file:
        all_data_leeuwarden = json.load(file)
    print("[main] loaded docs/data/leeuwarden.json")

    alert_times = {"begin": [], "end": []}
    past_hour_forcast_advies = "Geen alert"

    for forcast in all_data_leeuwarden["forecast"]:
        print(f"[main] forecast time={forcast['Tijd']} advies={forcast['Advies']}")
        if past_hour_forcast_advies != forcast["Advies"]:
            alert_times["begin" if forcast["Advies"] == "Alert" else "end"].append(forcast["Tijd"])
            past_hour_forcast_advies = forcast["Advies"]

    if not alert_times["begin"]:
        print("Geen alerts gevonden in de data.")
        return

    print(f"[main] alert begin times={alert_times['begin']}")
    print(f"[main] alert end times={alert_times['end']}")

    # Maak een boodschap met de tijden van begin en eind van een hittestress periode
    periodes = []
    for i, begin in enumerate(alert_times['begin']):
        if i < len(alert_times['end']):
            periodes.append(f"vanaf {begin} tot {alert_times['end'][i]}")
        else:
            periodes.append(f"vanaf {begin}")

    # Bijv: vanaf 18-06-2026 11:00 tot 19-06-2026 00:00 en vanaf 19-06-2026 09:00 tot 20-06-2026 03:00 en vanaf 20-06-2026 10:00 in Leeuwarden
    notification_body = " en ".join(periodes) + " in Leeuwarden"
    print(f"[main] notification body={notification_body}")

    required_envs = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_KEY": SUPABASE_KEY,
        "VAPID_PUBLIC_KEY": VAPID_PUBLIC_KEY,
        "VAPID_PRIVATE_KEY": VAPID_PRIVATE_KEY,
        "VAPID_SUBJECT": VAPID_SUBJECT,
    }
    for name, value in required_envs.items():
        require_env(name, value)

    print("[main] creating Supabase client")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    rows = fetch_all_subscriptions(supabase)

    sent = skipped = removed = failed = 0

    for row in rows:
        print(f"[main] processing row id={row.get('id')}")
        subscription_data = get_data_from_row(row)
        if not subscription_data:
            skipped += 1
            print(f"[main] skipped row id={row.get('id')}")
            continue
        try:
            print(f"[main] sending push to id={row.get('id')}")
            webpush(
                subscription_info=subscription_data,
                data=json.dumps({
                    "title": "Hittestress",
                    "body": notification_body,
                    "url": "/",
                }),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT}
            )
            sent += 1
            print(f"[main] push sent to id={row.get('id')}")
        except WebPushException as e:
            status_code = e.response.status_code if e.response is not None else None
            print(f"[main] push failed for id={row.get('id')} status={status_code}")
            if status_code == 410:
                remove_subscription_by_id(supabase, row["id"])
                removed += 1
            else:
                failed += 1
                print(f"Push mislukt voor id={row['id']}: {e}", file=sys.stderr)

    print(f"Klaar. Totaal={len(rows)}, verzonden={sent}, verwijderd_410={removed}, overgeslagen={skipped}, gefaald={failed}")
    print("[main] done")


if __name__ == "__main__":
    main()
