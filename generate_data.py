import requests
import os
import json
import time

# --- Configurations ---
API_KEY = os.getenv("METEOSERVER_API_KEY")
if not API_KEY:
    print("Error: METEOSERVER_API_KEY environment variable not set.")
    exit(1)

OUTPUT_DIR = "docs/data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

STATIONS = {
    "Leeuwarden": {"lat": 53.22, "lon": 5.75},
    # "Goutum": {"lat": 53.18, "lon": 5.80},
    # "De Bilt": {"lat": 52.10, "lon": 5.18},
    # "Groningen (Eelde)": {"lat": 53.13, "lon": 6.58},
    # "Maastricht": {"lat": 50.91, "lon": 5.77},
    # "Rotterdam": {"lat": 51.95, "lon": 4.44},
    # "Vlissingen": {"lat": 51.45, "lon": 3.60},
    # "Den Helder": {"lat": 52.92, "lon": 4.78},
    # "Twenthe": {"lat": 52.27, "lon": 6.89},
    # "Eindhoven": {"lat": 51.45, "lon": 5.37},
    # "Lelystad": {"lat": 52.45, "lon": 5.52},
    # "Hoogeveen": {"lat": 52.75, "lon": 6.52},
    # "Alkmaar": {"lat": 52.63, "lon": 4.75},
    # "Zwolle": {"lat": 52.51, "lon": 6.09},
    # "Arnhem": {"lat": 51.98, "lon": 5.91},
}

# --- Functions ---
def calculate_thi(temp, rh):
    """Bereken de Temperature Humidity Index (THI)."""
    return 0.8 * temp + (rh / 100) * (temp - 14.4) + 46.4

def get_thi_alert(thi):
    """Bepaalt de alertstatus op basis van de THI (binnen)."""
    return "Alert" if thi >= 72 else "Geen alert"

def fetch_and_process(name, lat, lon):
    print(f"Fetching data for {name}...")
    api_url = f"https://data.meteoserver.nl/api/uurverwachting.php?locatie={name}&key={API_KEY}"
    
    try:
        r = requests.get(api_url)
        print(f"Response for {name}: {r.content}")
        print(api_url)

        if r.status_code != 200:
            print(f"Error {r.status_code} for {name}: {r.text}")
            return None
        
        data = r.json().get("data")
        if not data:
            print(f"No data returned for {name}")
            return None
        
        forecast_list = []
        for forecast in data:
            temp_out = float(forecast["temp"])
            rh = float(forecast["rv"])
            # Vereenvoudigde berekening voor binnentemperatuur
            temp_in = 0.81 * temp_out + 5.60
            
            thi_out = calculate_thi(temp_out, rh)
            thi_in = calculate_thi(temp_in, rh)
            
            forecast_list.append({
                "Tijd": forecast["tijd_nl"],
                "Temp_Out": temp_out,
                "RH": rh,
                "THI_Out": round(thi_out, 1),
                "THI_In": round(thi_in, 1),
                "Advies": get_thi_alert(thi_in)
            })
            
        result = {
            "station": name,
            "lat": lat,
            "lon": lon,
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "forecast": forecast_list
        }
        
        # Save to file
        filename = name.lower().replace(" ", "_").replace("(", "").replace(")", "") + ".json"
        with open(os.path.join(OUTPUT_DIR, filename), "w") as f:
            json.dump(result, f, indent=4)
            
        return result
        
    except Exception as e:
        print(f"Exception processing {name}: {e}")
        return None

# --- Main ---
if __name__ == "__main__":
    results = []
    for name, coords in STATIONS.items():
        res = fetch_and_process(name, coords["lat"], coords["lon"])
        if res:
            results.append({"name": name, "file": name.lower().replace(" ", "_").replace("(", "").replace(")", "") + ".json"})
            
    # Save a manifest of all available stations
    with open(os.path.join(OUTPUT_DIR, "stations.json"), "w") as f:
        json.dump(results, f, indent=4)
        
    print("Data update complete.")
