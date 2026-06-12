import os
from dotenv import load_dotenv
import pandas as pd
from supabase import create_client

load_dotenv()
supa = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

for sym in ["SOLUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "WIFUSDT"]:
    resp = supa.table("funding_rates").select("*").eq("symbol", sym).execute()
    df = pd.DataFrame(resp.data)
    if not df.empty:
        df['funding_rate'] = df['funding_rate'].astype(float)
        print(f"{sym}: Max FR = {df['funding_rate'].max():.6f}, Min FR = {df['funding_rate'].min():.6f}")
    else:
        print(f"{sym}: NO DATA")
