import type { AppData, Proposal } from "./assistant";
import { normalizeProposal } from "./assistant";
import { NO_EDITS } from "./assistantEdits";
import { generalRoleId } from "./catalog";
import {
  bare,
  dayText,
  find,
  missingOf,
  NOT_DESCRIPTION,
  plus,
  QUESTIONS,
  words,
  WORK_START,
  type Learned,
  type Local,
  type PendingJob,
} from "./freeCommands";
import { datesForPinned, ownRole } from "./pinnedDates";
import { NIGHT_LIMIT } from "./planner";
import type { SolverOption } from "./solvers";

// "תמצא לי מתי יוסי וניר פנויים לעבודת לילה בערד" (the user's request, 2026-11-08): done here, free, like the
// other built-in voice commands (src/lib/freeCommands.ts). The app finds the nearest days all the named
// workers are free, with enough others for the rest of the places (src/lib/pinnedDates.ts), says them,
// and the manager picks one ("הראשון"); it is then a new job with those workers pinned, to confirm.
// Safety as there: every word must be explained, anything more goes to Claude.

// "פנויים", "זמינים": the question is when workers are free.
const FREE_WORD =
  /^ש?(?:פנוי|פנויה|פנויים|פנוים|פנויות|זמין|זמינה|זמינים|זמינות)$/;
// "מתי", "תמצא": asking for a day, not saying one.
const WHEN_WORD = /^(?:מתי|תמצא|מצא|תמצאי|למצוא|תבדוק|בדוק|תבדקי|לבדוק)$/;
// Words that only carry the question.
const QUESTION_WORDS = new Set(
  "תמצא מצא תמצאי למצוא תבדוק בדוק תבדקי לבדוק מתי תאריך תאריכים יום ימים מועד הכי קרוב הקרוב הקרובים הקרובה שהם שניהם שלושתם כולם יחד ביחד לעבודה עבודה עבודת לעבודת ועוד יהיו יהיה יכולים הם ש ל ב".split(
    " ",
  ),
);
const isQuestionWord = (w: string) =>
  FREE_WORD.test(w) ||
  WHEN_WORD.test(bare(w)) ||
  QUESTION_WORDS.has(w) ||
  QUESTION_WORDS.has(bare(w));

/** The job asked about and the workers who must be in it; null when the sentence is anything more. */
export function datesPlan(
  text: string,
  d: AppData,
  L: Learned,
  now: Date,
): { job: PendingJob["job"]; pinned: string[] } | null {
  const ws = words(text);
  if (
    !ws.some((w) => FREE_WORD.test(w)) ||
    !ws.some((w) => WHEN_WORD.test(bare(w)))
  )
    return null;
  const f = find(text, d, L.aliases, now, L.protect);
  if (!f.workerIds.length || f.unsure.length) return null;
  let location = f.location ?? "";
  const unknown = f.restAt.filter((_, k) => !isQuestionWord(f.rest[k]));
  if (unknown.length) {
    // At most one place not in the lists, said with ב, maybe with numbers after it ("בירוחם", "בערד 17").
    const first = ws[unknown[0]];
    const tail = unknown.slice(1).map((at) => ws[at]);
    const inRow = unknown.every(
      (at, k) => k === 0 || at === unknown[k - 1] + 1,
    );
    if (
      location ||
      !inRow ||
      !/^ב-?(?=.{2,})/.test(first) ||
      WORK_START.test(first) ||
      NOT_DESCRIPTION.test(bare(first)) ||
      tail.some((w) => !/^\d+$/.test(w))
    )
      return null;
    location = [first.replace(/^ב-?/, ""), ...tail].join(" ");
  }
  const general = generalRoleId(d.roles);
  // A place for each worker who must be there, in their own role, then the other people said ("ועוד חשמלאי").
  const own = f.workerIds.map((id) =>
    ownRole(
      d.workers.find((w) => w.id === id)!,
      d.roles,
      general,
    ),
  );
  const staffing = [
    ...own.map((roleId) => ({ roleId, count: 1 })),
    ...f.staffing,
  ];
  const kind =
    f.shiftKindId ??
    (d.shiftDefinitions.length === 1 ? d.shiftDefinitions[0].id : "");
  return {
    job: {
      date: f.date ?? "",
      shiftKindId: kind,
      location,
      jobDescription: f.description ?? "",
      staffing,
      autoAssign: true,
    },
    pinned: f.workerIds,
  };
}

/** The first sentence: "מתי יוסי וניר פנויים...". A missing kind or place is asked first. */
export function freeDates(
  text: string,
  d: AppData,
  L: Learned,
  now: Date,
): Local {
  const plan = datesPlan(text, d, L, now);
  if (!plan) return null;
  return continueDates(
    plan.job,
    missingOf({ ...plan.job, autoAssign: false }),
    plan.pinned,
    d,
    now,
  );
}

/** After an answer: the next question, or the days. */
export function continueDates(
  job: PendingJob["job"],
  missing: ReturnType<typeof missingOf>,
  pinned: string[],
  d: AppData,
  now: Date,
): Local {
  // A day is never asked here: finding it is the point.
  const left = missing.filter((m) => m !== "date");
  if (left.length)
    return {
      kind: "ask",
      question: QUESTIONS[left[0]](d),
      pending: { job, missing: left, pinned },
    };
  return pinnedDays(job, pinned, d, now);
}

const andList = (xs: string[]) =>
  xs.length < 2
    ? xs.join("")
    : `${xs.slice(0, -1).join(", ")} ו${xs[xs.length - 1]}`;
const orList = (xs: string[]) =>
  xs.length < 2
    ? xs.join("")
    : `${xs.slice(0, -1).join(", ")} או ${xs[xs.length - 1]}`;

/** The nearest days the pinned workers are free for this job, each a ready proposal, said with the question which. */
export function pinnedDays(
  job: PendingJob["job"],
  pinned: string[],
  d: AppData,
  now: Date,
): Local {
  const general = generalRoleId(d.roles);
  const today = plus(now, 0);
  // "מתי יוסי פנוי אחרי 15.11": from that day on.
  const from = job.date && job.date > today ? job.date : today;
  const staffing = job.staffing.flatMap((s) =>
    Array.from({ length: Math.max(1, s.count) }, () => ({ roleId: s.roleId })),
  );
  const draft = {
    id: "free-dates",
    date: from,
    shiftDefinitionId: job.shiftKindId || undefined,
    location: job.location,
    jobDescription: job.jobDescription,
    crew: [],
    staffing,
  };
  const ctx = {
    workers: d.workers,
    records: d.shifts,
    defs: d.shiftDefinitions,
    roles: d.roles,
    certifications: d.certifications,
    generalId: general,
  };
  const options = datesForPinned(draft, pinned, from, ctx);
  // Full names: two workers may share a first name (the user, 2026-11-08).
  const first = (id: string) => {
    const w = d.workers.find((x) => x.id === id);
    return w ? `${w.firstName} ${w.lastName}`.trim() : "";
  };
  const who = andList(pinned.map(first));
  const free = pinned.length === 1 ? "פנוי" : "פנויים";
  if (!options.length)
    return {
      kind: "say",
      text: `לא מצאתי בחודשיים הקרובים יום ש${who} ${free} בו ויש מספיק עובדים לשאר המקומות.`,
    };
  const kind =
    d.shiftDefinitions.find((s) => s.id === job.shiftKindId)?.name ?? "";
  const where = [job.location ? `ב${job.location}` : "", job.jobDescription]
    .filter(Boolean)
    .join(", ");
  const must = pinned.length === 1 ? "חייב" : "חייבים";
  const solverOptions: SolverOption[] = options.map((o) => {
    const added = o.addedIds.map(first);
    const nights = o.nightIds.map(first);
    const also = added.length ? ` ואשבץ גם את ${andList(added)}.` : "";
    const warn = nights.length
      ? ` שים לב: ${andList(nights)} כבר עם ${NIGHT_LIMIT} לילות באותו שבוע.`
      : "";
    const proposal: Proposal = {
      ...normalizeProposal({}),
      summary: `עבודה חדשה: ${kind ? `${kind} ` : ""}${dayText(o.date, now)}${where ? `, ${where}` : ""}. ${who} ${must} להיות בה.${also}${warn} לאשר, או שיש עוד תיקון?`,
      jobs: [
        {
          ...job,
          date: o.date,
          staffing: job.staffing.map((s) => ({ ...s, certificationIds: [] })),
          workKindIds: [],
          note: "",
          nextJob: { location: "", jobDescription: "" },
          crew: o.shift.crew.filter((c) => pinned.includes(c.workerId)),
          autoAssign: true,
        },
      ],
    };
    return {
      kind: "move",
      title: dayText(o.date, now),
      actions: [
        added.length
          ? `ייכנסו גם: ${added.join(", ")}`
          : "אין צורך בעוד עובדים",
        ...(nights.length
          ? [`${andList(nights)} כבר עם ${NIGHT_LIMIT} לילות באותו שבוע`]
          : []),
      ],
      why: `${who} ${free}`,
      cost: nights.length ? `יותר מ-${NIGHT_LIMIT} לילות בשבוע` : "אין",
      changes: NO_EDITS,
      proposal,
    };
  });
  const days = orList(options.map((o) => dayText(o.date, now)));
  const spoken =
    options.length === 1
      ? `${who} ${free} ${days}. לקבוע?`
      : `${who} ${free} ${days}. איזה יום לקבוע, הראשון, השני${options.length > 2 ? " או השלישי" : ""}?`;
  return {
    kind: "advise",
    spoken,
    options: solverOptions,
    extra: NO_EDITS,
    extraText: "",
  };
}
