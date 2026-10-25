# Yako Trading – Profit & Expense Tracker

A simple web app for recording what Yako Trading spends and earns on goods imported from China to Ghana, and seeing the profit.

- **Records**: log expenses (goods purchase, freight, customs & clearing, transport, …) and money in (sales, shipping charged to clients). Amounts can be in GHS, USD or RMB; they are converted to GHS with the rate you enter.
- **Shipments**: group costs and sales by container/order to see the profit on each shipment.
- **Overview**: money in, expenses, profit and margin for any period, with monthly and category charts.
- **Export**: download records as a CSV file that opens in Excel, or a full JSON backup.

Works on phones and computers. No build step: it is plain HTML, CSS and JavaScript.

## Where the data is stored

- With no setup, records are kept only in the browser on that device.
- With **Supabase** (free online database) connected, records are stored online and you sign in with email and password from any device. Each account sees only its own records.

## Setup (one time)

### 1. Online database (Supabase)
1. Go to https://supabase.com, click **Start your project**, and sign up (GitHub or email).
2. Click **New project**. Name it `yako-tracker`, set a database password (save it somewhere), pick the region closest to Ghana (e.g. *West EU (London)* or *Central EU (Frankfurt)*), and create it. Wait about a minute.
3. In the left menu open **SQL Editor**, click **New query**, paste everything from [`supabase/schema.sql`](supabase/schema.sql), and press **Run**. You should see "Success".
4. Open **Project Settings → API** (or the **Connect** button) and copy the **Project URL** and the **anon public** key.
5. Put them in [`config.js`](config.js) (or paste them in the app under **Settings → Connect online storage**).

Optional: under **Authentication → Sign In / Providers → Email**, turn off **Confirm email** if you don't want to click a confirmation link when creating your account.

### 2. Publish the app (GitHub Pages)
In this repository on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**. After a minute the app is live at `https://<your-username>.github.io/yako-tracker/`.

On your phone, open that link and use **Add to Home screen** to get an app icon.

## Files
- `index.html`, `style.css`, `app.js` – the app
- `config.js` – Supabase connection details
- `supabase/schema.sql` – database tables and security rules
- `vendor/` – bundled Chart.js and Supabase libraries
