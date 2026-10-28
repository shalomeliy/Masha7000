# Spike: Hebrew voice dictation (v0.3)

## Question

Can the manager dictate a Hebrew note (partial-close text, postpone reason) by voice, on their phone, from inside the web app?

- Success: a mic button in the app turns Hebrew speech into text in a field, on the user's phone.
- Failure: the browser has no Hebrew speech recognition, or it needs a paid service or a backend.

## What was built

`spikes/hebrew-dictation/index.html`: one page, `SpeechRecognition` / `webkitSpeechRecognition` with `lang = 'he-IL'`, interim + continuous results, writes into a textarea, logs support, start, results with latency, errors.

## How it was run

Opened at `http://localhost:5180/spikes/hebrew-dictation/index.html` in the Claude desktop browser pane (Chromium 152).

## Actual output

```
SpeechRecognition: yes | secure: true | ... Chrome/152.0.7977.167 ...
```

Pressing record asked for the microphone, which the browser pane blocks. So the API exists, but speech-to-text was **not** observed end to end here. It still needs a real run on the user's phone (and/or desktop Chrome).

## What is known without running it

- Chrome on Android and desktop: supports `he-IL`. Audio goes to Google's speech service, so it needs internet. Free, no key.
- Safari on iPhone (14.5+): `webkitSpeechRecognition` exists; Hebrew works when the device supports Hebrew dictation.
- Firefox: no support. The button is hidden there.
- Requires HTTPS (or localhost). The phone cannot open the dev server's localhost, so the phone test needs the Vercel deploy (or desktop Chrome for now).
- Fallback that always works, with zero code: every phone keyboard (Gboard, iPhone keyboard) has a mic key that dictates Hebrew into any text field.

## Verdict: GO, with a fallback

Build a small reusable `DictationField`: a textarea plus a mic button shown only when the browser supports speech recognition. If recognition fails (no permission, no network), show one Hebrew line and keep the text already typed. The keyboard mic remains the fallback, so the feature never blocks on this API.

Open item: the user tries the mic on their phone once the app is on Vercel (or on desktop Chrome at localhost:5180 now).
