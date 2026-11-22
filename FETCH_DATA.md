# Fetching Westermann Vokabeltrainer book data

This documents how the vocabulary data for *Camden Market 5* and *Camden Market 6* was extracted from `Westermann Vokabeltrainer 1.3.1`, so the same can be done in another project without repeating the investigation.

Only use this for books you are entitled to access.

## Key facts

| Item | Value |
|---|---|
| Android package | `de.westermann.vocabulary_trainer_2019` |
| Firebase project | `iw-iwk00110-vokabel-2019` |
| Storage bucket | `iw-iwk00110-vokabel-2019.appspot.com` |
| Realtime DB | `https://iw-iwk00110-vokabel-2019.firebaseio.com` |
| Firebase API key (in `resources.arsc`) | `AIzaSyB7I3wDjiuOmeMtvbLXy-yJKcUiMb1uQm8` |
| App is Flutter; logic is in `lib/arm64-v8a/libapp.so` | no vocabulary data bundled in the APK |

Known book IDs:

| Book | ID | Volume ID | Words |
|---|---|---|---:|
| Camden Market 5 | `sGSjiQCrLM5T3uUgn50X` | `H6Hb9QdqawRLnSyZsguO` | 957 |
| Camden Market 6 | `JiV5V1pQHcx0dRuKKHCG` | `H6Hb9QdqawRLnSyZsguO` | 725 |

## What does NOT work

- `https://iw-iwk00110-vokabel-2019.firebaseio.com/.json` → `401 Permission denied`.
- Firebase Storage object listing → `400`: listing is disallowed under `rules_version = "1"`.
- Anonymous sign-up via Identity Toolkit → `400 ADMIN_ONLY_OPERATION`.

So the catalog/DB cannot be scraped directly. The app itself, however, can browse and download books **without signing in**.

## Fetching data for a known book ID (no emulator needed)

All book media is publicly readable in Firebase Storage. `?alt=media` is enough — no auth, no token, no cookie.

### URL format (important)

The object path must be URL-encoded with **`%2F` separators**:

```
https://firebasestorage.googleapis.com/v0/b/iw-iwk00110-vokabel-2019.appspot.com/o/book%2F<bookId>%2Ffiles%2F<kind>%2F<filename>?alt=media
```

Using a literal `/` between segments returns `400 Invalid HTTP method/URL pair.`

### Where the manifest comes from

The app stores a JSON per downloaded book at:

```
/data/data/de.westermann.vocabulary_trainer_2019/files/<bookId>.json
```

Its `vocabulary` array has one entry per word:

```json
{
  "audio_file": "to_see.mp3",
  "base": "to see",
  "chapter": "W",
  "chapter_name": "Welcome to Camden Market",
  "example_phrase": "I _see_ with my eyes.",
  "image_file": "to_see.jpg",
  "page": "10",
  "part_of_speech": "",
  "section": "Welcome",
  "status": "",
  "task": "1",
  "translation": "sehen"
}
```

`base` is the English word, `translation` the German one, and underscores in `example_phrase` mark the word in use.

### Standalone fetch script

```python
import concurrent.futures
import json
import urllib.parse
import urllib.request
from pathlib import Path

BUCKET = "https://firebasestorage.googleapis.com/v0/b/iw-iwk00110-vokabel-2019.appspot.com/o"
OUT = Path("bookdata")  # change to your output directory

BOOKS = {
    "cm5": "sGSjiQCrLM5T3uUgn50X",
    "cm6": "JiV5V1pQHcx0dRuKKHCG",
}


def storage_url(book_id, kind, filename):
    path = "%2F".join(
        urllib.parse.quote(part, safe="")
        for part in ("book", book_id, "files", kind, filename)
    )
    return f"{BUCKET}/{path}?alt=media"


def fetch(job):
    url, dest = job
    if dest.exists() and dest.stat().st_size:
        return "skip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=30) as r:
        dest.write_bytes(r.read())
    return "ok"


for slug, book_id in BOOKS.items():
    # If you don't have the JSON yet, pull it from the app (see next section)
    # and save it as OUT / f"{slug}.json" first.
    data = json.loads((OUT / f"{slug}.json").read_text(encoding="utf-8"))

    jobs = [
        (storage_url(book_id, kind, name), OUT / "assets" / slug / kind / name)
        for entry in data["vocabulary"]
        for kind, field in (("audio", "audio_file"), ("image", "image_file"))
        if (name := entry.get(field, ""))
    ]
    if cover := data.get("cover_image_url"):
        jobs.append((cover, OUT / "assets" / slug / "cover.jpg"))

    stats = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for result in pool.map(fetch, jobs):
            stats[result] = stats.get(result, 0) + 1
    print(data["name"], len(jobs), stats)
```

Exporting the CSV is the same as `export_vocab.py` in this workspace: read `vocabulary`, keep fields `english=base`, `german=translation`, plus chapter/section/page/task/example, sort by the `pos` values in `chapters`, write UTF-8-BOM with `;` delimiter.

## Getting the JSON for a *new* book (emulator route)

This is the only part that needs a running app, because book IDs live behind the backend.

1. Install Android cmdline tools, `platform-tools`, `emulator`, and a system image:

   ```powershell
   sdkmanager --sdk_root=<sdk> "platform-tools" "emulator" "system-images;android-35;google_apis;x86_64"
   avdmanager create avd -n VocabAVD -k "system-images;android-35;google_apis;x86_64" -d pixel_7 --force
   ```

2. Install the XAPK's splits together — the ARM64 split is required even on an x86_64 AVD:

   ```powershell
   adb install-multiple base.apk config.arm64_v8a.apk config.en.apk config.mdpi.apk config.zh.apk
   adb root
   ```

   (The x86_64 emulator runs the app fine despite the ARM64-only `libapp.so`.)

3. In the app, navigate: **Englisch → Lehrwerk "Camden Market / Ausgabe 2020" → Bücher → <book>**. Selecting a book starts its download. Wait until the percentage indicator disappears.

4. The new `<bookId>.json` appears in `/data/data/de.westermann.vocabulary_trainer_2019/files/`. Pull it:

   ```powershell
   adb pull /data/data/de.westermann.vocabulary_trainer_2019/files/<bookId>.json bookdata/<slug>.json
   ```

5. Feed that JSON and its `id` into the standalone script above.

UI navigation can be automated with `adb shell uiautomator dump` + `content-desc` labels (`Zurück`, `Sprache`, `Englisch`, `Lehrwerk`, `Bücher`, book titles) and `adb shell input tap x y`. See `ui.py` in this workspace for a small helper.

## Notes / caveats

- A book's `id` in the JSON is also the folder name under `files/book/<id>/` and in the Storage object paths.
- Some media referenced by a JSON does not exist on the server (HTTP 404). For book 6: `postcard.jpg`, `fresh.jpg`, `future.jpg`. They are absent from the app's cache too, so this is upstream, not a download error.
- `cover_image_url` in the JSON includes a `token=` query parameter, but it is not required — `?alt=media` works for covers as well.
- `chapters[].free` marks chapters as locked in the UI, but the downloaded JSON contains all of them.
- `status` values like `aktiv` are learning progress, not part of the word list.

## Files in this workspace

| Path | Purpose |
|---|---|
| `extracted/bookdata/book.json`, `book6.json` | Source book JSONs |
| `extracted/bookdata/camden_market_*_vocabulary.csv` | Full exported word lists |
| `extracted/bookdata/camden_market_*_wordlist.txt` | `english<TAB>german` lists |
| `extracted/bookdata/assets/cm5/`, `cm6/` | Downloaded audio/images/covers |
| `extracted/export_vocab.py` | CSV/text exporter |
| `extracted/download_assets.py` | HTTPS media downloader |
| `extracted/ui.py` | uiautomator helper for emulator navigation |
