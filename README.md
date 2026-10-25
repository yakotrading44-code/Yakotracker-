# Yako Trading – Profit & Expense Tracker

A simple web app for recording what Yako Trading spends and earns on goods imported from China to Ghana, and seeing the profit.

- **Records**: log expenses (goods purchase, freight, customs & clearing, transport, …) and money in (sales, shipping charged to clients). Amounts can be in GHS, USD or RMB; they are converted to GHS with the rate you enter.
- **Shipments**: group costs and sales by container/order to see the profit on each shipment.
- **Overview**: money in, expenses, profit and margin for any period, with monthly and category charts.
- **Export**: download records as a CSV file that opens in Excel, or a full JSON backup.

Works on phones and computers. No build step: it is plain HTML, CSS and JavaScript.

## Where the data is stored

- With no setup, records are kept only in the browser on that device.
- With a **Google Sheet** connected, every record is saved in your own sheet in Google Drive (free). The app asks for a passcode once on each device. You can also open the sheet directly to view, sort or print your records.

## Setup (one time)

### 1. Google Sheet (your database)
1. Go to https://sheets.google.com and create a blank spreadsheet. Name it `Yako Trading Records`.
2. In the sheet, click **Extensions → Apps Script**.
3. Delete the code that is there, and paste everything from [`apps-script/Code.gs`](apps-script/Code.gs).
4. On the line `const PASSCODE = 'change-me';` replace `change-me` with your own secret word (keep the quotes). Click the **Save** icon.
5. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**.
6. Google asks you to authorize: click **Authorize access**, choose your account, then **Advanced → Go to (project name) → Allow**. (Google shows this warning for any script you write yourself.)
7. Copy the **Web app URL** (it ends in `/exec`). Put it in [`config.js`](config.js), or paste it in the app under **Settings → Connect Google Sheet**.

The **Records** and **Shipments** tabs appear in the sheet after you save your first entry. You can edit cells there, but don't change the header row or the ID columns.

If you change the code later, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy** so the same URL keeps working.

### 2. Publish the app (GitHub Pages)
In this repository on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**. After a minute the app is live at `https://<your-username>.github.io/yako-tracker/`.

On your phone, open that link and use **Add to Home screen** to get an app icon.

## Files
- `index.html`, `style.css`, `app.js` – the app
- `config.js` – link to your Google Sheet web app
- `apps-script/Code.gs` – the code that runs inside your Google Sheet
- `vendor/` – bundled Chart.js library
