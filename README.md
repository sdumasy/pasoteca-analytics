# Pasoteca Analytics

A small web app that answers questions about how dancers use Pasoteca:

1. Do new dancers get to their first move? (first-week funnel)
2. Do they come back? (weekly cohorts)
3. How busy is the app, week to week?
4. Is the class → moves → practice loop working?
5. Where does it get in the way? (clipper, downloads, unfinished work)
6. Does sharing bring dancers in?
7. Does the paywall convert?

It reads two BigQuery datasets in `p-pasoteca`:

- **`analytics_<property id>`**: Google Analytics' own daily export of the
  app's events (see `network/lib/helper/analytics.dart` in the app).
- **`firestore_export`**: a copy of the app's collections, written every night
  by the app's `exportFirestoreToBigQuery` Cloud Function, with emails,
  usernames and photos left out.

The page signs in with Google (Firebase Auth on `p-pasoteca`); the server
only answers accounts listed in `ALLOWED_EMAILS`.

## Run it locally

```sh
npm ci
DEMO=1 NEXT_PUBLIC_DEMO=1 npm run dev   # made-up numbers, no sign-in
npm test
```

## One-time setup

1. **Google Analytics → BigQuery.** Firebase console → `p-pasoteca` → Project
   settings → Integrations → BigQuery → Link, with *Google Analytics* on and
   *daily* export. Data starts the day it is switched on. Note the dataset
   it creates: `analytics_` followed by a number.

2. **Google Cloud** (as an owner of `p-pasoteca`):

   ```sh
   P=p-pasoteca R=europe-west1
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com bigquery.googleapis.com --project $P
   gcloud artifacts repositories create pasoteca --repository-format=docker \
     --location $R --project $P

   # The dashboard's own identity: may read BigQuery, nothing else.
   gcloud iam service-accounts create analytics-dashboard --project $P
   for role in roles/bigquery.dataViewer roles/bigquery.jobUser; do
     gcloud projects add-iam-policy-binding $P \
       --member serviceAccount:analytics-dashboard@$P.iam.gserviceaccount.com --role $role
   done

   # The account GitHub deploys with.
   gcloud iam service-accounts create analytics-deployer --project $P
   for role in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer \
               roles/iam.serviceAccountUser roles/storage.admin roles/serviceusage.serviceUsageConsumer; do
     gcloud projects add-iam-policy-binding $P \
       --member serviceAccount:analytics-deployer@$P.iam.gserviceaccount.com --role $role
   done
   gcloud iam service-accounts keys create key.json \
     --iam-account analytics-deployer@$P.iam.gserviceaccount.com
   ```

3. **GitHub** (this repo → Settings → Secrets and variables → Actions):
   - secret `GCP_SA_KEY`: the contents of `key.json` (then delete the file)
   - variable `GA_DATASET`: the `analytics_…` dataset from step 1
   - variable `ALLOWED_EMAILS`: the Google accounts that may look, comma separated

4. **After the first deploy**, add the Cloud Run address (without `https://`)
   to Firebase console → Authentication → Settings → Authorized domains, so
   Google sign-in works there.

Pushing to `main` tests, builds and deploys. Other branches are only tested.
