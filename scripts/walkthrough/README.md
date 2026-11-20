# Teacher walkthrough video

A scripted, chaptered product walkthrough of the teacher web app, recorded
from the real app. One command reseeds a fresh world and rebuilds everything,
so after a UI change you just run it again.

```
python -m scripts.walkthrough.record --out /path/to/out
```

Outputs, in `--out` (default `$WALKTHROUGH_OUT`, else `$TMPDIR/veradic-walkthrough`):

| file | what |
|---|---|
| `walkthrough.mp4` | 1280×720 H.264 + AAC, `+faststart`, ≤ 25 MB (CRF steps up until it fits) |
| `walkthrough.vtt` | captions: each beat's narration, split into ≤ 2-line cues of ~42 chars (cue ids are `<beat id>-<n>`) |
| `chapters.json` | `[{"id", "title", "start"}]`, start in seconds; ids are stable deep-link targets |
| `chapters.vtt` | the same chapters as a WebVTT chapters track |
| `poster.jpg` | a frame from the welcome chapter |
| `timeline.json` | every beat's start/length, the CRF used, and app errors seen while recording |
| `work/` | intermediates (raw recording, narration WAVs, cards, segments) |

## Before you run

- The local stack is up: web on `--web` (default `http://localhost:3010`) and
  the API on `--api` (default `http://localhost:8010`), with `.env` pointing at
  a database you don't mind seeding (the walkthrough DB). Run from the repo
  root with the project's Python.
- `ffmpeg`, `ffprobe`, macOS `say`, and Playwright's Chromium.
- Local photo URLs: the API signs dev photo links with `PHOTO_LOCAL_BASE_URL`
  (default `:8000`). The recorder reroutes those requests to `--api`, so the
  student-work images load even when that variable isn't set. If you set it,
  pass `--photo-origin` to match (or leave it; a match is a no-op).

## What it does

1. **Seed** (`seed.py`): builds on `scripts/seed_design_audit_world.seed()`
   (Ms. Rivera, three courses, ~33 students, homework in every state), then
   readable emails and fixed join codes, `tours_seen` so the old tour never
   mounts, one flagged understanding check with a transcript, one
   low-confidence AI grade, a draft homework with worked solutions, and two
   missing turn-ins. The previous run's world is renamed out of the way.
2. **Narration**: one WAV per beat, from `say` (default voice Samantha) or
   from your voice-over folder. Durations are measured with ffprobe.
3. **Record**: Chromium at 1440×900 with a visible cursor that glides to each
   element and ripples on click. Each beat starts its narration, runs its
   actions, and holds until the narration ends (+0.4 s). A colour sync mark
   flashed before and after every chapter (in moments that are cut) pins
   wall-clock time to video time; Chromium's screencast can lag seconds
   behind on a busy machine, so each chapter is retimed between its own pair
   of marks. `timeline.json` records the lag measured at each mark.
4. **Produce**: cuts each chapter out of the raw recording (chapter setup and
   page loads are dropped), puts a 1.5 s title card before each, lays every
   beat's narration at its timestamp, and encodes.

It never calls the AI. The script never clicks Generate and friends, and every
AI route is blocked at the network layer as well: if anything tries, the run
fails and prints what.

## Editing the script

Everything lives in `script.py`: chapters → beats → `{narration, actions}`.
Narration is plain text; the same text drives the TTS, the captions and the
voice-over script. To print it as a reading script:

```
python -m scripts.walkthrough.script --markdown > walkthrough-script.md
```

Chapter ids are deep-link targets in the app; don't rename them. Beat ids name
the voice-over files, so renaming a beat means renaming its take.
`PRONOUNCE` in `script.py` fixes how the TTS says things (e.g. "Algebra I").

## Swapping in a human voice-over

1. Print the script (above). Record one take per beat and save it as
   `<beat id>.wav` (also `.m4a`, `.mp3`, `.aiff`), e.g. `welcome.loop.wav`,
   `grading.partial.wav`, all in one folder.
2. Rerun with that folder:

   ```
   python -m scripts.walkthrough.record --out /path/to/out --voiceover /path/to/takes
   ```

Each take sets its own beat's length (the recorder holds the screen until the
take ends), and leading/trailing silence is trimmed and loudness normalised.
Beats without a take fall back to the TTS voice and are listed at the start of
the run, so you can re-record a few beats at a time.

## Handy flags

- `--qa` writes two frames per beat to `out/qa/` for a quick visual check.
- `--no-seed` reuses the last world (only for re-encoding experiments: the
  recording mutates the world, so a second pass over the same world will
  differ).
- `--only grading,grades` records just those chapters; chapters build on each
  other's state, so use it for iteration, not for a cut.
- `--voice`, `--rate` for a different placeholder voice; `--headed` to watch.

## Shipping a new cut into the app

The web app plays `web/public/walkthrough/{walkthrough.mp4,walkthrough.vtt,poster.jpg}`
and reads chapter ids, titles and starts from
`web/src/components/walkthrough/walkthrough.json`. After a run:

```
OUT=/path/to/out
cp $OUT/walkthrough.mp4 $OUT/walkthrough.vtt $OUT/poster.jpg web/public/walkthrough/
python - <<PY
import json, subprocess
ch = json.load(open("$OUT/chapters.json"))
dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries",
    "format=duration", "-of", "csv=p=0", "$OUT/walkthrough.mp4"]))
json.dump({"duration": round(dur, 2), "chapters": ch},
          open("web/src/components/walkthrough/walkthrough.json", "w"), indent=2)
PY
```

Chapter ids are deep-link targets (`ChapterId` in `components/walkthrough`):
renaming or removing one is a code change, not just a re-record.
