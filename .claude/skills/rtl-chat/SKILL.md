---
name: rtl-chat
description: >
  Render responses as styled RTL HTML widgets (show_widget) in the Cowork chat panel.
  Use ONLY when the user explicitly asks for it: "RTL", "RTL mode", "יישור לימין",
  "עברית נשברת", or says Hebrew text looks misaligned. Hebrew content alone is not a
  trigger. Not for Claude Code terminal sessions or files, where show_widget does not exist.
---

# RTL Chat Mode

When this skill is active, render every substantive response as an HTML widget using `show_widget`.
This solves the Cowork chat panel's default LTR rendering which breaks Hebrew and mixed-direction text.

## When to use show_widget vs plain text

**Use show_widget** for: any response with Hebrew text, mixed Hebrew/English, lists, steps, structured content, tables, or code with Hebrew labels.

**Plain text is OK** for: single-word/emoji acknowledgements like "✅ הבנתי" or "בסדר!".

## The RTL widget template

Every widget must start with this shell. Fill `{{CONTENT}}` with the body HTML:

```html
<div style="
  font-family: 'Heebo', 'Arial Hebrew', Arial, sans-serif;
  direction: rtl;
  text-align: right;
  background: #FAFAF8;
  border-radius: 12px;
  padding: 20px 24px;
  line-height: 1.75;
  color: #0A0A14;
  font-size: 15px;
  max-width: 100%;
  box-sizing: border-box;
">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;900&display=swap" rel="stylesheet">
{{CONTENT}}
</div>
```

## Content building blocks

Use these HTML snippets inside `{{CONTENT}}`:

### Headings
```html
<h2 style="font-size:19px;font-weight:700;margin:0 0 12px;color:#0A0A14;">כותרת</h2>
<h3 style="font-size:16px;font-weight:600;margin:16px 0 8px;color:#2B2B35;">תת-כותרת</h3>
```

### Body paragraph
```html
<p style="margin:0 0 12px;">הטקסט שלך כאן. <span dir="ltr" style="unicode-bidi:embed">English inline</span> ממשיך עברית.</p>
```

### Bullet list
```html
<ul style="margin:8px 0 12px;padding-right:20px;padding-left:0;list-style-position:inside;">
  <li style="margin-bottom:6px;">פריט ראשון</li>
  <li style="margin-bottom:6px;">פריט שני</li>
</ul>
```

### Numbered list
```html
<ol style="margin:8px 0 12px;padding-right:20px;padding-left:0;">
  <li style="margin-bottom:8px;">שלב ראשון</li>
  <li style="margin-bottom:8px;">שלב שני</li>
</ol>
```

### Highlighted callout (purple)
```html
<div style="background:#F0E6FF;border-right:3px solid #A259FF;border-radius:6px;padding:10px 14px;margin:12px 0;font-weight:500;">
  💡 טיפ חשוב או הדגשה
</div>
```

### Warning callout (yellow)
```html
<div style="background:#FFF4CC;border-right:3px solid #F5B800;border-radius:6px;padding:10px 14px;margin:12px 0;">
  ⚠️ שים לב
</div>
```

### Code block (for commands / prompts)
```html
<pre dir="ltr" style="background:#1a1a2e;color:#a8d8ea;font-family:'JetBrains Mono',monospace;font-size:13px;padding:12px 16px;border-radius:8px;overflow-x:auto;text-align:left;margin:10px 0;">
YOUR CODE HERE
</pre>
```

### Section divider
```html
<hr style="border:none;border-top:1px solid #E5E2D8;margin:16px 0;">
```

### English-only inline span
Whenever an English word/phrase appears mid-Hebrew sentence, wrap it:
```html
<span dir="ltr" style="unicode-bidi:embed;font-family:'Space Grotesk',sans-serif;">English phrase</span>
```

## Mixed Hebrew/English rules

1. **The outer container is always `dir="rtl"`** — Hebrew sentences flow correctly by default.
2. **English words inside Hebrew sentences** — wrap with `<span dir="ltr" style="unicode-bidi:embed">`.
3. **All-English paragraphs** — use `<p dir="ltr" style="text-align:left;">`.
4. **Code blocks are always** `dir="ltr"`.
5. **File paths, URLs, variable names** — always `dir="ltr"` inline spans.

## Toggling RTL mode off

If the user says "כבה RTL", "turn off RTL", "back to normal" — confirm with a brief widget, then return to plain text responses.

## Example — a typical response

User asks: "מה ההבדל בין Skill ל-Agent?"

Render as:
```html
<div style="font-family:'Heebo','Arial Hebrew',Arial,sans-serif;direction:rtl;text-align:right;background:#FAFAF8;border-radius:12px;padding:20px 24px;line-height:1.75;color:#0A0A14;font-size:15px;max-width:100%;box-sizing:border-box;">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap" rel="stylesheet">

<h2 style="font-size:19px;font-weight:700;margin:0 0 16px;color:#0A0A14;">Skill לעומת Agent — מה ההבדל?</h2>

<h3 style="font-size:16px;font-weight:600;margin:0 0 8px;color:#A259FF;">🔧 Skill</h3>
<p style="margin:0 0 12px;">קובץ הוראות שאומר לקלוד <em>איך</em> לעשות משהו. הוא לא עושה כלום בעצמו — הוא מדריך את קלוד לבצע משימה בצורה מסוימת.</p>

<h3 style="font-size:16px;font-weight:600;margin:0 0 8px;color:#3ECF8E;">🤖 Agent</h3>
<p style="margin:0 0 12px;">ישות שיש לה מטרה, זיכרון, וכלים. היא פועלת לאורך זמן, מקבלת החלטות, ויכולה לקרוא ל-Skills בעצמה.</p>

<div style="background:#F0E6FF;border-right:3px solid #A259FF;border-radius:6px;padding:10px 14px;margin:12px 0;font-weight:500;">
  💡 Skill = מתכון. Agent = שף שמשתמש במתכונים.
</div>
</div>
```

## Activation message

When the skill first activates, show this widget to confirm RTL is on:

```html
<div style="font-family:'Heebo',Arial,sans-serif;direction:rtl;text-align:right;background:#F0E6FF;border-radius:10px;padding:14px 18px;color:#0A0A14;font-size:15px;border:1px solid #A259FF;">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap" rel="stylesheet">
✅ <strong>מצב RTL פעיל</strong> — כל התשובות יוצגו עכשיו בעברית מיושרת לימין.
<br><small style="color:#6B6B7A;">להחזרה למצב רגיל: כתוב "כבה RTL"</small>
</div>
```
