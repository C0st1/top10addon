---

# 🎬 Netflix Top 10 — Stremio Addon

A fast, reliable **Stremio addon** that delivers real-time **Netflix Top 10 rankings** across 90+ countries.

Powered by live data scraping from FlixPatrol and enhanced with accurate metadata matching via TMDB, this addon brings up-to-date global and regional trends directly into your Stremio experience.

---

## 🚀 Features

* 🌍 **90+ Countries Supported**
  Explore Netflix Top 10 charts from Argentina to Vietnam.

* 🌐 **Global Rankings**
  Access a dedicated **Global Top 10** catalog for worldwide trends.

* ⚡ **Live Data + Smart Caching**
  Real-time scraping from FlixPatrol with caching for optimal performance.

* 🎛️ **Customizable Catalogs**
  Add multiple countries and reorder them using a drag-and-drop interface.

* 🎯 **Accurate Metadata Matching**
  Advanced title matching using year and popularity logic ensures correct Stremio results.

* ⭐ **RPDB Integration (Optional)**
  Enhance posters with rating overlays via Rating Poster DB.

* ☁️ **Vercel-Ready Deployment**
  Optimized for serverless deployment with zero hassle.

---

## 🛠️ Setup & Installation

### 1. Get a TMDB API Key

This addon requires a free TMDB API key to fetch metadata like posters, descriptions, and IDs.

1. Sign up at [https://www.themoviedb.org](https://www.themoviedb.org)
2. Navigate to **Settings → API**
3. Generate your API key

---

### 2. Configure & Install the Addon

1. Deploy the addon (see deployment section below) or use a hosted instance
2. Open the configuration page:

   ```
   https://your-addon-url.vercel.app/configure
   ```
3. Enter your **TMDB API Key**
4. Add your desired countries
5. (Optional) Add your **RPDB API Key**
6. Click **Generate Install Link**
7. Click **Install to Stremio**

---

## 💻 Deployment

### 🚀 Deploy to Vercel (Recommended)

This project is pre-configured for seamless Vercel deployment:

```bash
# Clone the repository
git clone <your-repo-url>

# Navigate into the project
cd <project-folder>

# Install Vercel CLI (if not installed)
npm i -g vercel

# Deploy
vercel
```

---

### 🧪 Local Development

```bash
# Install dependencies
npm install

# Start development server
npm start
```

Access the configuration page at:
👉 [http://localhost:3000/configure](http://localhost:3000/configure)

---

## 📂 Project Structure

```
.
├── api/
│   └── index.js        # Core logic: scraping, matching, catalog generation
├── vercel.json         # Vercel serverless configuration
├── package.json        # Dependencies (e.g., Cheerio)
```

---

## ⚙️ Configuration Options

| Option             | Description                                                 |
| ------------------ | ----------------------------------------------------------- |
| **TMDB API Key**   | Required. Fetches metadata like posters, backdrops, and IDs |
| **Country Select** | Add multiple countries (each creates Movies & TV catalogs)  |
| **RPDB API Key**   | Optional. Enables rating-enhanced posters                   |
| **Tab Overrides**  | Optional. Rename "Movies" / "Series" tabs in Stremio        |

---

## ⚖️ Disclaimer

This project is **not affiliated with Netflix**.

It uses publicly available data (via FlixPatrol) to curate ranking-based catalogs for personal use within the Stremio ecosystem.

---

## ⭐ Contributing

Contributions, issues, and feature requests are welcome!
Feel free to open a PR or start a discussion.

---
