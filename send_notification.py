import json
import os
import sys

from datetime import datetime

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
    if not value:
        exit(1)


def get_data_from_row(row):
    data = row.get("data")
    if not data or not isinstance(data, dict):
        return None
    if "endpoint" in data and "keys" in data:
        return {"endpoint": data["endpoint"], "keys": data["keys"]}
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
    with open("docs/data/leeuwarden.json", "r") as file:
        all_data_leeuwarden = json.load(file)

    alert_times = {"begin": [], "end": []}
    past_hour_forcast_advies = "Geen alert"

    for forcast in all_data_leeuwarden["forecast"]:
        if past_hour_forcast_advies != forcast["Advies"]:
            alert_times["begin" if forcast["Advies"] == "Alert" else "end"].append(forcast["Tijd"])
            past_hour_forcast_advies = forcast["Advies"]

    if not alert_times["begin"]:
        return

    # Maak een boodschap met de tijden van begin en eind van een hittestress periode
    periodes = []
    days_nl = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
    for i, begin in enumerate(alert_times['begin']):
        begin_object = datetime.strptime(begin, "%d-%m-%Y %H:%M")
        begin_day = days_nl[begin_object.weekday()]
        if i < len(alert_times['end']):
            end_object = datetime.strptime(alert_times['end'][i], "%d-%m-%Y %H:%M")
            end_day = days_nl[end_object.weekday()]
            periodes.append(f"van {begin_day} {begin_object.strftime('%H:%M')} tot {end_day} {end_object.strftime('%H:%M')}")
        else:
            periodes.append(f"vanaf {begin_day} {begin_object.strftime('%H:%M')}")

    # Bijv: van 18-06-2026 11:00 tot 19-06-2026 00:00 en van 19-06-2026 09:00 tot 20-06-2026 03:00 en van 20-06-2026 10:00 in Leeuwarden
    notification_body = " en ".join(periodes) + " in Leeuwarden"
    print(f"notification body={notification_body}")

    required_envs = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_KEY": SUPABASE_KEY,
        "VAPID_PUBLIC_KEY": VAPID_PUBLIC_KEY,
        "VAPID_PRIVATE_KEY": VAPID_PRIVATE_KEY,
        "VAPID_SUBJECT": VAPID_SUBJECT,
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
                    "title": "Hittestress",
                    "body": notification_body,
                    "url": "/",
                }),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT}
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
