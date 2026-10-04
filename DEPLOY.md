# CF Analyzer — Deploy Guide

## GitHub Actions (Recommended — works while your PC is off)

### How it works

> **Manual only.** The weekly schedule was removed — retraining does not measurably
> improve the models, and the crawl adds data that is not comparable to the original
> dataset. Trigger **Weekly Crawl & Retrain** from the Actions tab (or `gh workflow run`)
> when you want a deliberate refresh. The diagram below is what a run does.

```
When triggered (previously every Sunday 02:00 UTC)
  │
  ├─ 1. Download previous dataset from latest GitHub Release
  ├─ 2. Crawl Codeforces API (5,000 users, ~1.5 hrs)
  ├─ 3. Run preprocessing pipeline (rebuild CSVs)
  ├─ 4. Retrain all 3 LightGBM models
  ├─ 5. Publish new GitHub Release with:
  │      dataset-YYYYMMDD.tar.gz  (all CSVs)
  │      models-YYYYMMDD.tar.gz   (all .pkl files)
  └─ 6. Ping the Railway deploy hook
         │
         └─ Railway redeploys → scripts/start.sh runs
            fetch_latest_release.sh → live site serves the new models
```

No server required. GitHub provides free compute (~2,000 minutes/month on free tier; the weekly job takes ~2 hours = ~8 hrs/month).

Note that the dataset and models are **never committed to the repo** — `.gitignore`
excludes `*.csv`, `*.pkl` and `*.tar.gz`. GitHub Releases are the distribution
channel, and the live site pulls from them at deploy time. Step 6 exists because
publishing a release does not by itself update the running site: Railway only
fetches new models when it redeploys.

### Step 1 — Seed the initial dataset (one-time, from your machine)

Install the GitHub CLI if you haven't:
```bash
brew install gh
gh auth login
```

Package your local dataset and models:
```bash
cd /path/to/cf-analyzer

tar -czf dataset-init.tar.gz -C ML/dataset .
tar -czf models-init.tar.gz  -C ML/models  .
```

Create the first release and upload:
```bash
gh release create data-init \
  --repo Mazen-4/Codeforces-Performance-Analyzer \
  --title "Initial dataset seed" \
  --notes "Manual seed from local machine" \
  --prerelease \
  dataset-init.tar.gz \
  models-init.tar.gz

rm dataset-init.tar.gz models-init.tar.gz
```

### Step 2 — Push the workflows to GitHub

```bash
git add .github/workflows/ scripts/
git commit -m "Add GitHub Actions weekly retrain workflow"
git push
```

### Step 3 — Add the Railway deploy hook (one-time)

Without this, every weekly run still publishes a release, but the live site keeps
serving the previous week's models until it happens to redeploy.

Railway has moved this setting around, so the workflow accepts **either** of two
approaches. Use whichever your dashboard offers.

**Option A — deploy hook (if you can find it).**
Railway → your service → **Settings** → scroll to **Deploy Triggers** (older
projects call it *Deploy Hooks*). Create one pointed at `main` and copy the URL.
Add it as the GitHub secret `RAILWAY_DEPLOY_HOOK`.

**Option B — API token (works on every dashboard version).**
Newer Railway projects may not show deploy hooks at all. Instead:

1. Railway → **project Settings** → **Tokens** → create a token scoped to this
   project. (Account tokens under your user settings work too.)
2. Get the service and environment IDs from the browser URL while the service is
   open:
   `railway.com/project/<projectId>/service/<SERVICE_ID>?environmentId=<ENVIRONMENT_ID>`
3. Add three GitHub secrets: `RAILWAY_TOKEN`, `RAILWAY_SERVICE_ID`,
   `RAILWAY_ENVIRONMENT_ID`.

Add secrets under GitHub repo → **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**.

Treat these as credentials — anyone holding them can trigger deploys, which is why
they live in secrets rather than in the workflow file.

If none of them is set the workflow now **fails** at this step: the run's whole
purpose is to get new models onto the live site, so silently skipping the redeploy
would be a green run that changed nothing. Set `ALLOW_NO_REDEPLOY=1` to opt out.

Do **not** use Railway's *Cron Schedule* setting for this. It runs the service on a
schedule and then stops it, which would take the website offline; scheduling lives
in GitHub Actions.

### Step 4 — Verify the workflow runs

- Go to your repo → **Actions** tab → **Weekly Crawl & Retrain**
- Click **Run workflow** to trigger it manually for the first time
- Watch the logs — it should download your seeded data, crawl ~5,000 users, retrain, and publish a new release

It does not run on a schedule; trigger it manually whenever a refresh is wanted.

### Manually trigger a run

```bash
gh workflow run weekly-retrain.yml \
  --repo Mazen-4/Codeforces-Performance-Analyzer \
  -f crawl_users=1000    # smaller crawl for testing
```

### Fetch the latest dataset onto a new machine

```bash
./scripts/fetch_latest_release.sh
```

This downloads and extracts the most recent release assets into `ML/dataset/` and `ML/models/`.

---

# Hosting the website on Railway (from scratch)

Everything to click through on a brand-new Railway account. The build and start
commands come from the repo automatically — you never type them.

**Before you start, have these two things ready:**

- A **Gemini API key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → *Create API key* → copy it.
- At least one **`data-*` release** on the GitHub repo. If the repo is brand new and has
  no releases yet, do
  [Step 1 — Seed the initial dataset](#step-1--seed-the-initial-dataset-one-time-from-your-machine)
  first, or the build will fail with *"No release with dataset + model assets found."*

## Step 1 — Create the project

1. Go to [railway.app](https://railway.app) → **Login with GitHub**.
2. **New Project** → **Deploy from GitHub repo**.
3. **Configure GitHub App** → grant Railway access to `Codeforces-Performance-Analyzer`.
4. Pick the repo from the list.

Railway immediately starts a build. **It will fail** — the variables aren't set yet.
That's expected; continue to Step 2.

## Step 2 — Add the variables

Click the service → **Variables** tab → **New Variable** for each row:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | *(paste your Gemini key)* |
| `GH_REPO` | `Mazen-4/Codeforces-Performance-Analyzer` |
| `NODE_ENV` | `production` |
| `PYTHONUNBUFFERED` | `1` |

**If you start over on a different GitHub account**, `GH_REPO` must be the **new**
`owner/repo` — this is where the site downloads its models from. Leave it pointing at the
old account and the site will keep serving the old account's models.

**Add `GH_TOKEN` only if the repo is private.** GitHub → *Settings → Developer settings →
Personal access tokens → Tokens (classic)* → generate one with the **`repo`** scope, and
add it as a `GH_TOKEN` variable. Public repo: skip this entirely.

> ⚠️ **Do not add `PORT` or `PROJECT_ROOT`.** Railway sets `PORT` itself, and the app
> finds its own path. Adding either one manually breaks the site — this is the most
> common way to get a failing health check.

## Step 3 — Check the settings

Open the **Settings** tab and confirm these were filled in from the repo. If any is
blank, paste the value:

| Setting | Value |
|---|---|
| Build command | `bash scripts/setup_render.sh` |
| Start command | `bash scripts/start.sh` |
| Health check path | `/health` |

(The `setup_render.sh` name is historical — Railway uses it too. Don't rename it.)

## Step 4 — Deploy and get a URL

1. **Deployments** tab → **Deploy** (or *Redeploy* the failed one). First build takes a
   few minutes — it installs Python + Node, builds the frontend, and downloads the models.
2. **Settings → Networking → Generate Domain**.
3. Open the URL. Add `/health` to the end — it should respond OK.

## Step 5 — Turn on automatic model updates

This is what makes the weekly retrain reach the live site without you touching anything.

1. **Settings → Deploy Hooks** → **Create Deploy Hook** → branch `main` → **copy the URL**.
2. Go to the **GitHub repo** → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**:
   - Name: `RAILWAY_DEPLOY_HOOK`
   - Secret: *(paste the URL)*

Treat that URL like a password — anyone with it can trigger deploys.

Now each run of the workflow: the retrain publishes a new release, pings this hook, Railway
redeploys, and the site picks up the fresh models. Nothing is pushed to `main`.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Build fails: **`sh: 1: vite: not found`** | `NODE_ENV=production` makes npm skip devDependencies, where vite lives. The build script passes `npm ci --include=dev` to defeat this — make sure you're on a commit that includes that fix, and don't remove the flag. |
| Build warns `EBADENGINE` about vite/node | Node is older than vite 7 requires (`^20.19.0 \|\| >=22.12.0`). `nixpacks.toml` pins `nodejs_23` — the only version in Nixpacks' nixpkgs revision that qualifies (20 → 20.18.0 and 22 → 22.10.0 both fall just short). Don't lower it. |
| Build fails: **`collision between … nodejs-22 … and … nodejs-20 … node.bash`** | Two Node packages got installed at once. Almost always caused by adding `nodePackages.npm` to `nixPkgs` — it pulls its own Node 20. Remove it; the `nodejs_*` package already ships npm. |
| Build fails: *"No release with dataset + model assets found"* | The repo has no `data-*` release, or `GH_REPO` points at the wrong owner. Seed a release first. |
| Build fails downloading models on a **private** repo | `GH_TOKEN` is missing or expired. See Step 2. |
| Site loads, but AI feedback errors | `GEMINI_API_KEY` is missing or invalid. |
| Health check fails / site unreachable | You added `PORT` or `PROJECT_ROOT`. Delete both, redeploy. |
| Site still serves last week's models | `RAILWAY_DEPLOY_HOOK` isn't set on GitHub. Check the weekly run's *Trigger Railway redeploy* step. |

---

# Docker & Kubernetes Deploy Guide (local)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Kubernetes (Minikube / Docker Desktop)             │
│                                                     │
│  ┌───────────────────┐     ┌─────────────────────┐  │
│  │  cf-analyzer-web  │     │   cf-retrain CronJob │  │
│  │  (Node + Python)  │     │   (Every Sunday 2am) │  │
│  │  port 3000        │     │   Crawl → Preprocess │  │
│  └────────┬──────────┘     │   → Retrain models  │  │
│           │                └────────┬────────────┘  │
│           └────────────────────────┘                │
│                        │                            │
│              ┌──────────▼──────────┐                │
│              │   cf-data-pvc (2Gi) │                │
│              │   /data/dataset/    │                │
│              │   /data/models/     │                │
│              └─────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

Two Docker images:
- **`cf-analyzer-web`** — Express server (port 3000) + React static files + Python venv for ML inference
- **`cf-analyzer-pipeline`** — Python-only image for the weekly crawl + retrain job

One PVC (`cf-data-pvc`) is shared by both: the web pod reads CSVs/models, the retrain job writes new ones.

---

## Prerequisites

```bash
# Install tools
brew install minikube kubectl docker

# Start Minikube with enough resources
minikube start --cpus=4 --memory=6g --disk-size=20g
```

---

## Quick Start (Docker Compose — local dev)

```bash
# 1. Set your Gemini API key
echo "GEMINI_API_KEY=your-key-here" > .env

# 2. Build images
docker compose build

# 3. Seed the volume with your existing local dataset + models
docker compose run --rm seed

# 4. Start the web server
docker compose up web

# App is live at http://localhost:3000
```

To manually trigger a retrain:
```bash
docker compose run --rm retrain
```

---

## Kubernetes Deploy (Minikube)

### 1. Build and load images into Minikube

```bash
# Build both images
docker build -f Dockerfile.web      -t cf-analyzer-web:latest      .
docker build -f Dockerfile.pipeline -t cf-analyzer-pipeline:latest  .

# Load into Minikube's local daemon (no registry needed)
minikube image load cf-analyzer-web:latest
minikube image load cf-analyzer-pipeline:latest
```

### 2. Apply manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/secret.yaml        # edit GEMINI_API_KEY first (see below)
kubectl apply -f k8s/deployment-web.yaml
kubectl apply -f k8s/service-web.yaml
kubectl apply -f k8s/cronjob-retrain.yaml
```

### 3. Set the Gemini API key

```bash
# Option A — patch the secret directly (recommended, no file changes)
kubectl create secret generic cf-analyzer-secrets \
  --namespace cf-analyzer \
  --from-literal=GEMINI_API_KEY="your-key-here" \
  --dry-run=client -o yaml | kubectl apply -f -

# Option B — edit k8s/secret.yaml, fill in base64 value, then apply
echo -n "your-key-here" | base64
# paste result into k8s/secret.yaml under GEMINI_API_KEY
kubectl apply -f k8s/secret.yaml
```

### 4. Seed the PVC with your dataset and models

```bash
# Create the /data/dataset and /data/models directories on the PVC
kubectl apply -f k8s/job-seed.yaml
kubectl wait --for=condition=complete job/cf-data-seed -n cf-analyzer --timeout=60s

# Copy your local files into the PVC via a temporary pod
kubectl run seed-shell --rm -it \
  --image=busybox --restart=Never \
  --overrides='{"spec":{"volumes":[{"name":"d","persistentVolumeClaim":{"claimName":"cf-data-pvc"}}],"containers":[{"name":"seed-shell","image":"busybox","volumeMounts":[{"name":"d","mountPath":"/data"}],"command":["sh"]}]}}' \
  -n cf-analyzer

# In a separate terminal while seed-shell is running:
kubectl cp ML/dataset/ cf-analyzer/seed-shell:/data/dataset/
kubectl cp ML/models/  cf-analyzer/seed-shell:/data/models/
# Then exit the shell
```

### 5. Access the app

```bash
# Get the URL
minikube service cf-analyzer-web -n cf-analyzer --url

# Or use port-forward
kubectl port-forward svc/cf-analyzer-web 3000:3000 -n cf-analyzer
# App at http://localhost:3000
```

### 6. Verify the CronJob

```bash
# List the CronJob
kubectl get cronjob -n cf-analyzer

# Manually trigger a run to test
kubectl create job --from=cronjob/cf-retrain cf-retrain-test -n cf-analyzer

# Watch logs
kubectl logs -n cf-analyzer job/cf-retrain-test -f
```

---

## Useful Commands

```bash
# Check pod status
kubectl get pods -n cf-analyzer

# Web server logs
kubectl logs -n cf-analyzer -l app=cf-analyzer-web -f

# Retrain job history
kubectl get jobs -n cf-analyzer

# Describe a failing pod
kubectl describe pod -n cf-analyzer <pod-name>

# Shell into the web pod
kubectl exec -it -n cf-analyzer deployment/cf-analyzer-web -- bash

# Delete everything and start fresh
kubectl delete namespace cf-analyzer
```

---

## Environment Variables Reference

| Variable | Service | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | web | — | Required for AI Coach tab |
| `ML_DATA_PATH` | web | `/data` | Path to PVC mount inside container |
| `DATA_DIR` | retrain | `/data` | Path to PVC mount inside container |
| `CF_CRAWL_USERS` | retrain | `5000` | Max users to crawl |
| `CF_MIN_RATING` | retrain | `900` | Min Codeforces rating to include |
| `CF_MAX_RATING` | retrain | `3500` | Max Codeforces rating to include |

---

## CronJob Schedule

Default: `0 2 * * 0` — every Sunday at 02:00 UTC.

To change, edit `schedule` in [k8s/cronjob-retrain.yaml](k8s/cronjob-retrain.yaml):
```yaml
schedule: "0 2 * * 0"   # Sun 02:00 UTC
# schedule: "0 3 * * 1"   # Mon 03:00 UTC
```

The job has a 6-hour deadline (`activeDeadlineSeconds: 21600`). A full crawl of 5,000 users
at ~1 req/sec takes ~1.5 hours; preprocessing and retraining add ~30 minutes.
