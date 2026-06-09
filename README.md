# 🎯 Drishyamitra — Setup Guide

An AI-powered photo management application with face recognition, smart search, and sharing.

---

## 📋 Prerequisites

Make sure these are installed on your system:

| Tool | Version | Download |
|------|---------|----------|
| **Python** | 3.10 or higher | [python.org](https://www.python.org/downloads/) |
| **Node.js** | 18 or higher | [nodejs.org](https://nodejs.org/) |
| **Git** | Latest | [git-scm.com](https://git-scm.com/) |

> **Tip:** During Python installation, check ✅ **"Add Python to PATH"**

---

## 🚀 Step-by-Step Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/sathish0408/Drishyamitra.git
cd Drishyamitra
```

---

### Step 2: Backend Setup

```bash
# Navigate to backend folder
cd drishyamitra-backend

# Create a virtual environment
python -m venv .venv

# Activate the virtual environment
# Windows (PowerShell):
.venv\Scripts\activate
# Windows (CMD):
.venv\Scripts\activate.bat
# Linux/Mac:
source .venv/bin/activate

# You should see (.venv) in your terminal now

# Install Python dependencies
pip install -r requirements.txt

# Create the .env file from template
# Windows:
copy .env.example .env
# Linux/Mac:
cp .env.example .env
```

---

### Step 3: Configure the `.env` File

Open `drishyamitra-backend/.env` in a text editor and fill in your API keys:

#### 🔑 Required: Groq API Key (Free)
1. Go to [https://console.groq.com/keys](https://console.groq.com/keys)
2. Sign up / Log in (free)
3. Click **"Create API Key"**
4. Paste it in `.env`:
   ```
   GROQ_API_KEY=gsk_your_key_here
   ```

#### 📧 Optional: Gmail (for email sharing)
1. Enable **2-Factor Authentication** on your Google account
2. Go to [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Generate an **App Password** (select "Mail")
4. Paste in `.env`:
   ```
   SMTP_USER=your_email@gmail.com
   SMTP_PASSWORD=your_16_char_app_password
   ```

#### 💬 Optional: Twilio (for WhatsApp sharing)
1. Sign up at [https://www.twilio.com/try-twilio](https://www.twilio.com/try-twilio) (free trial)
2. Get your **Account SID** and **Auth Token** from the dashboard
3. Paste in `.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   ```
4. To use the WhatsApp sandbox, send **"join <sandbox-name>"** from your WhatsApp to **+1 (415) 523-8886**

---

### Step 4: Frontend Setup

```bash
# Open a new terminal
# Navigate to frontend folder
cd drishyamitra-frontend

# Install Node.js dependencies
npm install
```

---

### Step 5: Run the Project

You need **two terminals** running simultaneously:

#### Terminal 1 — Backend
```bash
cd drishyamitra-backend
.venv\Scripts\activate
python app.py
```
✅ You should see: `Drishyamitra Backend running on http://localhost:5000`

#### Terminal 2 — Frontend
```bash
cd drishyamitra-frontend
npm start
```
✅ Browser opens automatically at **http://localhost:3000**

---

## 🎉 You're Done!

Open [http://localhost:3000](http://localhost:3000) and start using Drishyamitra!

### First steps:
1. **Sign Up** — Create an account from the login page
2. **Upload Photos** — Go to Gallery and upload your photos
3. **Face Recognition** — Go to People tab to detect and label faces
4. **AI Chat** — Ask the AI assistant to find, organize, or share your photos
5. **Share** — Send photos via Email or WhatsApp from the Delivery page

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| `python` not recognized | Add Python to PATH or use `py` instead of `python` |
| `npm` not recognized | Install Node.js and restart your terminal |
| Port 3000 already in use | Close other apps or change port in `package.json` |
| Port 5000 already in use | Close other Flask apps running on port 5000 |
| `.venv\Scripts\activate` error on PowerShell | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` first |
| ModuleNotFoundError | Make sure virtual env is activated, then `pip install -r requirements.txt` |
| CORS errors in browser | Make sure backend is running on port 5000 |

---

## 📁 Project Structure

```
Drishyamitra/
├── drishyamitra-backend/       # Flask API Server
│   ├── agents/                 # AI agents (search, sharing, orchestrator)
│   ├── database/               # Database setup
│   ├── models/                 # SQLAlchemy models
│   ├── routes/                 # API endpoints
│   ├── services/               # Business logic (sharing, face detection)
│   ├── workflows/              # LangGraph agent workflows
│   ├── uploads/                # Uploaded photos stored here
│   ├── app.py                  # Main entry point
│   ├── requirements.txt        # Python dependencies
│   └── .env.example            # Environment variable template
│
├── drishyamitra-frontend/      # React Frontend
│   ├── src/
│   │   ├── components/         # React components
│   │   ├── styles/             # CSS and theme
│   │   ├── api.js              # API client
│   │   └── App.js              # Main app component
│   └── package.json            # Node.js dependencies
│
└── .gitignore
```
