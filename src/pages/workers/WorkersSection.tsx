import { useEffect, useState } from "react";
import { ArrowRight, Phone, Search, UserX, X } from "lucide-react";
import {
  Chips,
  Field,
  inputClass,
  Sheet,
  SheetActions,
} from "../../components/Sheet";
import {
  countText,
  filterWorkers,
  fullName,
  isActive,
  isIsraeliId,
  isIsraeliMobile,
  newId,
  telHref,
  upsert,
} from "../../lib/catalog";
import { constraintText, isOver, sickConstraint } from "../../lib/constraints";
import { useDriveList } from "../../lib/data/useDriveList";
import { daysToRanges, todayIso } from "../../lib/dates";
import { DateField } from "../../components/DateField";
import type { AbsenceKind, Constraint, Worker, WorkerStatus } from "../../types/models";
import { MonthDays } from "../../components/MonthDays";
import { DAY_NAMES } from "../../lib/shifts";
import { endAbsence, STATE_NAMES, STATE_TONE, teamStates, workerState, type StateId } from "../../lib/workerState";
import { EditMark, EmptyState } from "./common";
import { ConstraintsField } from "./ConstraintsField";
import { useWorkerAgenda, WorkerAgenda } from "./WorkerAgenda";
import { fixedConstraints } from "../../lib/workerAgenda";
import { WorkerMonth } from "./WorkerMonth";
import { ConstraintFormPanel } from "./ConstraintFormSection";
import { JoinButton, JoinPending } from "./JoinSection";
import { authMode } from "../../lib/google/auth";
import { tx } from '../../i18n'
import { departmentColor } from "../../lib/departmentColor";
import { searchWorkers } from "../../lib/workerSearch";
import { AverageStars, CertStarsField, RatingsSheet } from "./CertStars";
import { keepHeldRatings } from "../../lib/certRatings";
import { expiryCounts, expiryNote, expiryState, keepHeldExpiry } from "../../lib/certExpiry";

const blankWorker = (): Worker => ({
  id: newId(),
  firstName: "",
  lastName: "",
  certificationIds: [],
  constraints: [],
  status: "active",
});

const STATUSES: { id: WorkerStatus; name: string }[] = [
  { id: "active", name: tx('כשיר לעבודה (חזר לעבוד)') },
  { id: "sick", name: tx('במחלה עד תאריך') },
  { id: "inactive", name: tx('לא פעיל') },
];

const ABSENCE_MODES = [
  { id: "range", label: tx('מתאריך עד תאריך') },
  { id: "weekly", label: tx('קבוע כל שבוע') },
  { id: "days", label: tx('ימים מהלוח') },
] as const;

const ABSENCES: { id: AbsenceKind; name: string }[] = [
  { id: "vacation", name: tx('חופש') },
  { id: "study", name: tx('לימודים') },
  { id: "reserve", name: tx('מילואים') },
  { id: "course", name: tx('השתלמות או קורס') },
  { id: "sick", name: tx('מחלה בימים מסוימים') },
];

const STATUS_COLOR: Record<WorkerStatus, string> = {
  active: "text-emerald-400",
  sick: "text-orange-400",
  inactive: "text-red-400",
};

/** Sick until a day that has passed: active again, without anyone having to change it. */
const sickNow = (w: Worker, today: string) =>
  w.status === "sick" && !!w.sickUntil && w.sickUntil >= today;

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** The workers screen's tabs: the team list, and one tab for each thing done with the team. */
export type WorkersTab = "team" | "request" | "join" | "search";

/** `addRequest` grows by one each time the title row's "add" is pressed: opens a new worker's form. */
export function WorkersSection({ tab, addRequest = 0 }: { tab: WorkersTab; addRequest?: number }) {
  const workers = useDriveList("workers");
  const certs = useDriveList("certifications");
  const departments = useDriveList("departments");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Worker | null>(null);
  // Set while the open form came from a worker's answer: run once it is saved (removes the answer).
  const [onSaved, setOnSaved] = useState<(() => void) | null>(null);
  const edit = (w: Worker | null, saved?: () => void) => {
    setEditing(w);
    setOnSaved(() => saved ?? null);
  };
  const review = (w: Worker, saved: () => void) => edit(w, saved);
  useEffect(() => {
    if (addRequest > 0) edit(blankWorker());
  }, [addRequest]);
  const [rating, setRating] = useState<Worker | null>(null);
  const [certFilter, setCertFilter] = useState<string[]>([]);
  const [inactiveView, setShowInactive] = useState(false);
  const [stateFilter, setStateFilter] = useState<StateId | null>(null);
  const today = todayIso();

  // The inactive list and the state filter belong to the team tab; the certification filter to the search tab.
  const showInactive = tab === "team" && inactiveView;
  const searching = tab === "search";
  const typed = searching && query.trim() !== "";
  // While text is typed the certification chips are hidden, so they do not filter either.
  const chipFiltering = searching && !typed && certFilter.length > 0;
  const filtering = typed || chipFiltering;
  const byState = tab === "team" && !showInactive ? stateFilter : null;
  const inactiveCount = workers.items.filter((w) => !isActive(w)).length;
  // Inactive workers are kept (old shifts and reports name them) but listed only behind their own button.
  // Typed text searches everyone, inactive workers too, so an old name can still be found.
  const listed = typed ? workers.items : workers.items.filter((w) => isActive(w) !== showInactive);
  const team = teamStates(listed, today);
  const found = typed
    ? searchWorkers(listed, query, { certifications: certs.items, departments: departments.items }, today)
    : listed;
  const shown = filterWorkers(
    byState ? found.filter((w) => workerState(w, today).id === byState) : found,
    chipFiltering ? certFilter : [],
  ).sort((a, b) => fullName(a).localeCompare(fullName(b), "he"));

  const sheets = (
    <>
      <WorkerSheet editing={editing} onClose={() => edit(null)} onSaved={onSaved} />
      <RatingsSheet worker={rating} onClose={() => setRating(null)} />
    </>
  );

  if (tab === "request") {
    return (
      <>
        <TabIntro
          title={tx("מי לא יכול לעבוד מתי?")}
          text={tx("שולחים לקבוצת העובדים בוואטסאפ קישור לטופס של השבוע שבוחרים. כל עובד ממלא את הנייד שלו ובאילו ימים הוא לא יכול, ולוחץ שליחה. זה נכנס לבד לאילוצים שלו, אז השיבוץ יודע לא לשים אותו בימים האלה.")}
        />
        <ConstraintFormPanel />
        {sheets}
      </>
    );
  }

  if (tab === "join") {
    return (
      <>
        <TabIntro
          title={tx("העובדים ממלאים לבד")}
          text={tx("שולחים לעובדים בוואטסאפ קישור לטופס קצר. כל עובד ממלא שם, טלפון והסמכות, והתשובות מחכות כאן. בודקים, שומרים, ורק אז העובד נכנס לרשימה.")}
        />
        {/* The details form needs the server (the live site). */}
        {authMode() === "server" ? (
          <JoinButton />
        ) : (
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            {tx("הטופס עובד רק באתר החי של האפליקציה.")}
          </p>
        )}
        <div className="mt-3">
          <JoinPending onReview={review} />
        </div>
        {sheets}
      </>
    );
  }

  if (workers.items.length === 0) {
    return (
      <>
        <JoinPending onReview={review} />
        <EmptyState
          text={tx("כאן נמצאת רשימת העובדים שלך. לכל עובד מסמנים את ההסמכות שלו ונותנים לו כוכבים בכל אחת, ואז אפשר לחפש לפיהן.")}
          addLabel={tx("הוספת עובד")}
          onAdd={() => edit(blankWorker())}
        />
        {sheets}
      </>
    );
  }

  return (
    <>
      {searching && (
        <div className="mb-3 space-y-3">
          <TabIntro
            title={tx("מי מתאים לעבודה?")}
            text={tx("כותבים שם, טלפון, ת.ז או כל פרט אחר, או מסמנים הסמכות, ורואים רק את העובדים שמתאימים.")}
          />
          <label className="relative block">
            <span className="sr-only">{tx("חיפוש עובד")}</span>
            <Search size={18} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tx("שם, טלפון, ת.ז, מחלקה...")}
              enterKeyHint="search"
              className={`${inputClass} ps-10 pe-11 [&::-webkit-search-cancel-button]:appearance-none`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={tx("ניקוי החיפוש")}
                className="absolute end-0 top-0 flex h-full w-11 items-center justify-center text-slate-400"
              >
                <X size={18} aria-hidden />
              </button>
            )}
          </label>
          {typed ? null : certs.items.length === 0 ? (
            <p className="text-sm text-slate-400">{tx("עוד אין הסמכות. מוסיפים אותן בהגדרות.")}</p>
          ) : (
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
              {certs.items.length > 0 && (
                <div className="space-y-1">
                  <span className="text-sm text-slate-300">{tx("הסמכות")}</span>
                  <Chips options={certs.items} selected={certFilter} onToggle={(id) => setCertFilter((f) => toggle(f, id))} />
                </div>
              )}
              {chipFiltering && (
                <button
                  type="button"
                  onClick={() => {
                    setCertFilter([]);
                    setQuery("");
                  }}
                  className="flex min-h-11 items-center gap-1 text-sm text-slate-300"
                >
                  <X size={16} aria-hidden />
                  {tx("ניקוי הסינון")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showInactive && (
        <button
          type="button"
          onClick={() => setShowInactive(false)}
          className="mb-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-sky-500 px-3 text-start text-sm text-sky-300"
        >
          <ArrowRight size={16} aria-hidden className="shrink-0" />
          {tx("חזרה לעובדים הפעילים")}
        </button>
      )}

      {/* The team's state today: a count per state; a tap shows only those workers. */}
      {tab === "team" && !showInactive && team.length > 0 && (
        <section aria-label={tx("מצב הצוות היום")} className="mb-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{tx("מצב הצוות היום")}</h2>
          {/* Compact framed state counts in one row; if many show, they scroll sideways. */}
          <div className="flex gap-1.5 overflow-x-auto">
            {team.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={stateFilter === t.id}
                onClick={() => setStateFilter((f) => (f === t.id ? null : t.id))}
                className={`flex min-h-10 flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-1.5 text-xs ${
                  stateFilter === t.id ? "border-sky-500 text-sky-200" : "border-slate-700 text-slate-200"
                }`}
              >
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${STATE_TONE[t.id].dot}`} />
                {`${STATE_NAMES[t.id]} ${t.count}`}
              </button>
            ))}
          </div>
        </section>
      )}
      {tab === "team" && !showInactive && <JoinPending onReview={review} />}
      {showInactive && (
        <h2 className="mb-1 text-lg font-semibold">{tx("עובדים לא פעילים")}</h2>
      )}
      <p className="mb-2 text-sm text-slate-400" aria-live="polite">
        {byState
          ? tx("{v}: {length} מתוך {length2}", { v: STATE_NAMES[byState], length: shown.length, length2: listed.length })
          : filtering
          ? tx("{v} מתוך {length}", { v: countText(shown.length, tx("עובד אחד מתאים"), tx("עובדים מתאימים")), length: listed.length })
          : countText(
              listed.length,
              showInactive ? tx("עובד לא פעיל אחד") : tx("עובד פעיל אחד"),
              showInactive ? tx("עובדים לא פעילים") : tx("עובדים פעילים"),
            )}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          {typed
            ? tx("לא נמצא עובד שמתאים לחיפוש.")
            : filtering
            ? tx("אין עובד שיש לו את כל מה שסימנת.")
            : showInactive
              ? tx("אין עובדים לא פעילים.")
              : tx("כל העובדים מסומנים כלא פעילים.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((w) => (
            <li key={w.id}>
              <WorkerCard worker={w} onOpen={() => edit(w)} onRatings={() => setRating(w)} />
            </li>
          ))}
        </ul>
      )}
      {tab === "team" && !showInactive && inactiveCount > 0 && (
        <button
          type="button"
          onClick={() => setShowInactive(true)}
          className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-700 px-3 text-start text-sm text-slate-300"
        >
          <UserX size={16} aria-hidden className="shrink-0" />
          {tx("עובדים לא פעילים ({n})", { n: inactiveCount })}
        </button>
      )}
      {sheets}
    </>
  );
}

/** The short explanation at the top of an action tab. */
function TabIntro({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-3 space-y-1 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="font-semibold text-slate-100">{title}</h2>
      <p className="text-sm text-slate-300">{text}</p>
    </div>
  );
}

/**
 * One red "!" beside the worker's name when any of their certifications already expired or ends within
 * 30 days (the manager's request, 2026-11-09, instead of two counts). Nothing when all are fine.
 */
function ExpiryAlert({ worker, certIds, today }: { worker: Worker; certIds: string[]; today: string }) {
  const { soon, expired } = expiryCounts(worker, certIds, today);
  if (!soon && !expired) return null;
  const label = [
    expired > 0 ? tx('הסמכות שפג תוקפן: {n}', { n: expired }) : "",
    soon > 0 ? tx('הסמכות שעומדות לפוג: {n}', { n: soon }) : "",
  ].filter(Boolean).join(", ");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white"
    >
      !
    </span>
  );
}

function WorkerCard({
  worker: w,
  onOpen,
  onRatings,
}: {
  worker: Worker;
  onOpen: () => void;
  onRatings: () => void;
}) {
  const certs = useDriveList("certifications");
  const departments = useDriveList("departments");
  const certList = certs.items.filter((c) => w.certificationIds.includes(c.id));
  const department = departments.items.find(
    (d) => d.id === w.departmentId,
  )?.name;
  const today = todayIso();
  // A sickness saved as the worker's status ("חולה עד") is shown like one saved as a dated constraint.
  const sick = sickConstraint(w);
  const active = [...(sick ? [sick] : []), ...w.constraints].filter((c) => !isOver(c, today));
  const state = workerState(w, today);

  const dial = telHref(w.mobilePhone);

  return (
    <div className="flex items-stretch rounded-2xl border border-slate-800 bg-slate-900">
      <button
        type="button"
        onClick={onOpen}
        className="relative min-w-0 flex-1 space-y-2 p-4 pe-9 text-start"
      >
        <EditMark />
        {/* The mobile number is not shown in the list (the user's rule, 2026-11-09): it is in the worker's form, and the call button dials it. */}
        {/* Only a dot here (the user's rule); the state in words is inside the worker's form. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          <span role="img" aria-label={state.label} title={state.label} className={`size-2.5 shrink-0 rounded-full ${STATE_TONE[state.id].dot}`} />
          <span className="max-w-full truncate">{fullName(w)}</span>
          {/* One average star (a tap shows the stars in each certification) and the expiry "!", kept together. */}
          <span className="flex shrink-0 items-center gap-1.5">
            <AverageStars worker={w} certIds={certList.map((c) => c.id)} onOpen={onRatings} />
            <ExpiryAlert worker={w} certIds={certList.map((c) => c.id)} today={today} />
          </span>
        </span>
        <span className="flex flex-wrap gap-1">
          {department && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-200">
              {department}
            </span>
          )}
          {certList.map((c) => {
            const expiry = expiryState(w, c.id, today);
            return (
              <span
                key={c.id}
                title={expiryNote(w, c.id, today) ?? undefined}
                className={`rounded-full px-2 py-0.5 text-xs ${expiry === "expired" ? "bg-red-500/15 text-red-200" : expiry === "soon" ? "bg-orange-500/15 text-orange-200" : "bg-emerald-500/15 text-emerald-200"}`}
              >
                {c.name}
              </span>
            );
          })}
        </span>
        {active.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {active.slice(0, 2).map((c) => (
              <span
                key={c.id}
                className={`rounded-full px-2 py-0.5 text-xs ${c.kind === "sick" || c === sick ? "bg-rose-500/15 text-rose-200" : "bg-amber-500/15 text-amber-200"}`}
              >
                {constraintText(c)}
              </span>
            ))}
            {active.length > 2 && (
              <span className="px-1 text-xs text-amber-200">
                {tx('ועוד {v}', { v: active.length - 2 })}</span>
            )}
          </span>
        )}
      </button>
      {dial && (
        <a
          href={dial}
          aria-label={tx('חיוג אל {v}', { v: fullName(w) })}
          className="flex w-14 shrink-0 items-center justify-center border-s border-slate-800 text-emerald-400"
        >
          <Phone size={22} aria-hidden />
        </a>
      )}
    </div>
  );
}

function WorkerSheet({
  editing,
  onClose,
  onSaved,
}: {
  editing: Worker | null;
  onClose: () => void;
  onSaved?: (() => void) | null;
}) {
  const workers = useDriveList("workers");
  return (
    <Sheet
      open={editing !== null}
      title={
        editing && workers.items.some((w) => w.id === editing.id)
          ? tx('עריכת עובד')
          : tx('עובד חדש')
      }
      onClose={onClose}
      locked={workers.saving}
    >
      {editing && <WorkerForm key={editing.id} worker={editing} onDone={onClose} onSaved={onSaved ?? undefined} />}
    </Sheet>
  );
}

const PHONES = [
  ["mobilePhone", tx('טלפון נייד (חובה)')],
  ["homePhone", tx('טלפון בבית')],
  ["emergencyPhone1", tx('טלפון חירום 1')],
  ["emergencyPhone2", tx('טלפון חירום 2')],
] as const;

const OPTIONAL_TEXT = [
  "birthDate",
  "address",
  "notes",
  "idNumber",
  "personalNumber",
  ...PHONES.map(([f]) => f),
] as const;
type TextField = "firstName" | "lastName" | (typeof OPTIONAL_TEXT)[number];

function WorkerForm({
  worker,
  onDone,
  onSaved,
}: {
  worker: Worker;
  onDone: () => void;
  onSaved?: () => void;
}) {
  const workers = useDriveList("workers");
  const certs = useDriveList("certifications");
  const departments = useDriveList("departments");
  // A sickness that has ended opens as active, so the form shows what is true today.
  const [draft, setDraft] = useState<Worker>(() =>
    worker.status === "sick" && !sickNow(worker, todayIso())
      ? { ...worker, status: "active", sickUntil: undefined }
      : worker,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [departmentOpen, setDepartmentOpen] = useState(false);
  const draftState = workerState(draft, todayIso());
  const mainDial = telHref(draft.mobilePhone);
  const [error, setError] = useState<string | null>(null);
  const [birthDateValid, setBirthDateValid] = useState(true);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const exists = workers.items.some((w) => w.id === worker.id);
  // The next 3 days, from the draft: a status or an absence just picked shows before saving.
  const agenda = useWorkerAgenda(draft);
  const [monthOpen, setMonthOpen] = useState(false);
  // An X in the personal or monthly calendar: 'sick' is the status sickness (back to work), else a dated constraint.
  const removeAway = (id: string) =>
    setDraft((d) =>
      id === "sick"
        ? { ...d, status: "active", sickUntil: undefined }
        : { ...d, constraints: d.constraints.filter((c) => c.id !== id) },
    );
  // A pencil on an absence in a calendar: its editor opens under the personal calendar.
  const [openConstraint, setOpenConstraint] = useState<{ id: string; n: number }>();
  // "הוספת אילוץ" in the personal calendar: a new constraint's editor opens under it.
  const [addConstraint, setAddConstraint] = useState(0);
  const editAway = (id: string) => {
    setMonthOpen(false);
    setOpenConstraint((o) => ({ id, n: (o?.n ?? 0) + 1 }));
  };
  const editSick = () => {
    setMonthOpen(false);
    setStatusOpen(true);
  };

  const set = (field: TextField) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const write = async (next: Worker[], saved = true) => {
    setBusy(true);
    setSaveError(null);
    try {
      await workers.save(next);
      if (saved) onSaved?.();
      onDone();
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    // Names are not unique on purpose: two workers may share a name.
    const err = !draft.firstName.trim()
      ? tx('צריך למלא שם פרטי')
      : !draft.lastName.trim()
        ? tx('צריך למלא שם משפחה')
        : !draft.mobilePhone?.trim()
          ? tx('צריך למלא טלפון נייד')
          : !isIsraeliMobile(draft.mobilePhone)
            ? tx('הטלפון הנייד לא תקין. צריך 10 ספרות שמתחילות ב-05, למשל 050-1234567')
            : draft.idNumber?.trim() && !isIsraeliId(draft.idNumber)
              ? tx('תעודת הזהות לא תקינה. צריך 9 ספרות, למשל 012345678')
              : !birthDateValid
                ? tx('תאריך הלידה לא תקין')
                : draft.status === "sick" && !draft.sickUntil
                  ? tx('צריך לבחור עד איזה תאריך העובד במחלה')
                  : null;
    setError(err);
    if (err) return;
    const clean: Worker = {
      ...keepHeldExpiry(keepHeldRatings(draft)),
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
    };
    for (const f of OPTIONAL_TEXT) clean[f] = clean[f]?.trim() || undefined;
    clean.idNumber = clean.idNumber?.replace(/[\s-]/g, "") || undefined;
    if (clean.status !== "sick") clean.sickUntil = undefined;
    write(upsert(workers.items, clean));
  };

  return (
    <>
      {/* Names a little narrower, and the main mobile's call button at their end (the user's request, 2026-11-11). */}
      <div className="flex items-end gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          <Field label={tx('שם פרטי (חובה)')}>
            <input
              autoFocus
              value={draft.firstName}
              onChange={set("firstName")}
              className={inputClass}
            />
          </Field>
          <Field label={tx('שם משפחה (חובה)')}>
            <input
              value={draft.lastName}
              onChange={set("lastName")}
              className={inputClass}
            />
          </Field>
        </div>
        {mainDial ? (
          <a
            href={mainDial}
            aria-label={tx('חיוג: {label}', { label: tx('טלפון נייד (חובה)') })}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"
          >
            <Phone size={20} aria-hidden />
          </a>
        ) : (
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-800/60 text-slate-600">
            <Phone size={20} />
          </span>
        )}
      </div>

      {/* Small on purpose: one line under the name, the department first and the status after it.
          A tap on either opens its own screen (department: the user's request, 2026-11-11). */}
      <div className="-my-3 flex flex-wrap items-center gap-x-4 text-xs text-slate-400">
        <p className="min-w-0 flex items-center gap-1">
          {tx('מחלקה:')}{" "}
          <button
            type="button"
            onClick={() => setDepartmentOpen(true)}
            className={`inline-flex min-h-10 items-center font-semibold ${departmentColor(draft.departmentId, departments.items)}`}
          >
            {departments.items.find((d) => d.id === draft.departmentId)?.name ?? tx('בלי מחלקה')}
          </button>
        </p>
        <p className="flex items-center gap-1">
          {tx('סטטוס:')}{" "}
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            className={`inline-flex min-h-10 items-center font-semibold ${draftState.id === "fit" ? STATUS_COLOR.active : draftState.id === "inactive" ? STATUS_COLOR.inactive : STATUS_COLOR.sick}`}
          >
            {draftState.label}
          </button>
        </p>
      </div>
      <Sheet open={departmentOpen} title={tx('מחלקה')} onClose={() => setDepartmentOpen(false)}>
        {departments.items.length ? (
          <ul className="space-y-2">
            {[{ id: "", name: tx('בלי מחלקה') }, ...departments.items].map((dep) => {
              const chosen = (draft.departmentId ?? "") === dep.id;
              return (
                <li key={dep.id || "none"}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => {
                      setDraft((d) => ({ ...d, departmentId: dep.id || undefined }));
                      setDepartmentOpen(false);
                    }}
                    className={`flex min-h-12 w-full items-center rounded-xl border px-4 text-start ${departmentColor(dep.id, departments.items)} ${chosen ? "border-sky-400 bg-sky-500/15 font-semibold" : "border-slate-800 bg-slate-900"}`}
                  >
                    {dep.name}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-amber-300">
            {tx('עוד אין מחלקות. אפשר להוסיף אותן בהגדרות, "מחלקות".')}
          </p>
        )}
      </Sheet>
      <StatusSheet
        open={statusOpen}
        worker={draft}
        onClose={() => setStatusOpen(false)}
        onPick={(status, sickUntil) =>
          setDraft((d) => ({
            ...d,
            status,
            sickUntil,
            // Back to work: an absence going on today ends yesterday (or goes, if it starts today).
            constraints:
              status === "active" ? endAbsence(d.constraints, todayIso()) : d.constraints,
          }))
        }
        onAbsence={(added) =>
          setDraft((d) => ({
            ...d,
            status: d.status === "inactive" ? d.status : "active",
            sickUntil: undefined,
            constraints: [...d.constraints, ...added],
          }))
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('ת.ז')}>
          <input
            dir="ltr"
            inputMode="numeric"
            maxLength={11}
            value={draft.idNumber ?? ""}
            onChange={set("idNumber")}
            className={`${inputClass} text-right`}
          />
        </Field>
        <Field label={tx('מספר אישי')}>
          <input
            dir="ltr"
            inputMode="numeric"
            value={draft.personalNumber ?? ""}
            onChange={set("personalNumber")}
            className={`${inputClass} text-right`}
          />
        </Field>
      </div>
      <div className="space-y-1">
        <span className="text-sm text-slate-300">{tx('הסמכות')}</span>
        {/* Only the certifications the worker holds; more are added from the list under them, and an open
            row has "הסר הסמכה" (the user's request, 2026-11-10). A new worker's certifications start with
            no stars: the manager rates them (2026-11-08). */}
        {draft.certificationIds.length > 0 && (
          <p className="text-xs text-slate-400">{tx('כמה כוכבים העובד מקבל בכל הסמכה. לחיצה על הסמכה פותחת את הכוכבים, את תאריך התוקף ואת ההסרה שלה.')}</p>
        )}
        <CertStarsField
          worker={draft}
          certs={certs.items}
          onChange={setDraft}
          onRemove={(id) => setDraft((d) => ({ ...d, certificationIds: d.certificationIds.filter((x) => x !== id) }))}
        />
        {certs.items.length ? (
          certs.items.some((c) => !draft.certificationIds.includes(c.id)) && (
            <select
              aria-label={tx('הוסף הסמכה')}
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                setDraft((d) => ({
                  ...d,
                  certificationIds: d.certificationIds.includes(id) ? d.certificationIds : [...d.certificationIds, id],
                  ...(!exists ? { certRatings: { ...d.certRatings, [id]: 0 } } : {}),
                }))
              }}
              className={`${inputClass} text-slate-300`}
            >
              <option value="">{tx('+ הוסף הסמכה')}</option>
              {certs.items
                .filter((c) => !draft.certificationIds.includes(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          )
        ) : (
          <p className="text-sm text-amber-300">
            {tx('עוד אין הסמכות. אפשר להוסיף אותן בלשונית "הסמכות".')}
          </p>
        )}
      </div>

      {exists && (
        <WorkerAgenda
          items={agenda.items}
          fixed={fixedConstraints(draft.constraints, todayIso())}
          onAdd={() => setAddConstraint((n) => n + 1)}
          loading={agenda.loading}
          onRemove={removeAway}
          onEditSick={editSick}
          onEdit={editAway}
          onOpen={() => setMonthOpen(true)}
        />
      )}
      {/* A constraint's editor: from the calendar's pencil or its "add" button. */}
      <ConstraintsField
        value={draft.constraints}
        open={openConstraint}
        add={addConstraint}
        onChange={(constraints) => setDraft((d) => ({ ...d, constraints }))}
      />
      {exists && (
        <WorkerMonth
          worker={draft}
          open={monthOpen}
          onClose={() => setMonthOpen(false)}
          onRemove={removeAway}
          onEditSick={editSick}
          onEdit={editAway}
        />
      )}

      {/* Two phones side by side only where a whole number fits (phones 390 wide and up). */}
      <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
        {PHONES.map(([field, label]) => {
          const dial = telHref(draft[field]);
          return (
            <Field key={field} label={label}>
              <span className="flex gap-1">
                <input
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  value={draft[field] ?? ""}
                  onChange={set(field)}
                  className={`${inputClass} min-w-0 px-2.5! text-right`}
                />
                {/* Always shown so every phone field visibly has a call button; inactive until a number is typed. */}
                {dial ? (
                  <a
                    href={dial}
                    aria-label={tx('חיוג: {label}', { label })}
                    className="flex w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"
                  >
                    <Phone size={18} aria-hidden />
                  </a>
                ) : (
                  <span
                    aria-hidden
                    className="flex w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800/60 text-slate-600"
                  >
                    <Phone size={18} />
                  </span>
                )}
              </span>
            </Field>
          );
        })}
      </div>
      <DateField
        label={tx('תאריך לידה')}
        value={draft.birthDate ?? ""}
        min="1900-01-01"
        max={todayIso()}
        onChange={(birthDate, valid) => {
          setDraft((d) => ({ ...d, birthDate }));
          setBirthDateValid(valid);
        }}
      />
      <Field label={tx('כתובת')}>
        <input
          value={draft.address ?? ""}
          onChange={set("address")}
          className={inputClass}
        />
      </Field>
      <Field label={tx('הערות')}>
        <textarea
          rows={2}
          value={draft.notes ?? ""}
          onChange={set("notes")}
          className={inputClass}
        />
      </Field>

      <SheetActions
        onSave={save}
        onCancel={onDone}
        onDelete={
          exists
            ? () => write(workers.items.filter((w) => w.id !== worker.id), false)
            : undefined
        }
        deleteWarning={tx('למחוק את {v}? אי אפשר לבטל את זה.', { v: fullName(worker) })}
        busy={busy}
        error={error}
        saveError={saveError}
      />
    </>
  );
}

// Changing a status takes two steps on purpose: first "change it?", then which one. The change
// goes into the form and is kept when the form is saved.
function StatusSheet({
  open,
  worker,
  onClose,
  onPick,
  onAbsence,
}: {
  open: boolean;
  worker: Worker;
  onClose: () => void;
  onPick: (status: WorkerStatus, sickUntil?: string) => void;
  onAbsence: (added: Constraint[]) => void;
}) {
  const [step, setStep] = useState<"ask" | "pick" | "date" | "range">("ask");
  const [sickUntil, setSickUntil] = useState("");
  const [valid, setValid] = useState(false);
  const [kind, setKind] = useState<AbsenceKind>("vacation");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangeValid, setRangeValid] = useState({ from: false, to: false });
  const [mode, setMode] = useState<"range" | "weekly" | "days">("range");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const close = () => {
    setStep("ask");
    setSickUntil("");
    setFrom("");
    setTo("");
    setMode("range");
    setWeekdays([]);
    setPicked([]);
    onClose();
  };
  const pick = (status: WorkerStatus) => {
    if (status === "sick") return setStep("date");
    onPick(status);
    close();
  };
  const choice = "min-h-11 w-full rounded-xl border px-3 text-start text-sm";

  return (
    <Sheet open={open} title={tx('סטטוס העובד')} onClose={close}>
      {step === "ask" && (
        <>
          <p className="text-sm text-slate-300">
            {tx('הסטטוס של {v} עכשיו: {v2}. לשנות אותו?', { v: fullName(worker) || tx('העובד'), v2: workerState(worker, todayIso()).label })}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="min-h-11 rounded-xl bg-sky-600 text-sm font-medium text-white"
            >
              {tx('כן, לשנות')}
            </button>
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded-xl border border-slate-700 text-sm text-slate-300"
            >
              {tx('לא')}
            </button>
          </div>
        </>
      )}
      {step === "pick" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">{tx('לאיזה סטטוס?')}</p>
          {STATUSES.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => pick(st.id)}
              className={`${choice} ${(worker.status ?? "active") === st.id ? "border-sky-500 text-sky-300" : "border-slate-700 text-slate-200"}`}
            >
              {st.name}
              {st.id === "inactive" && (
                <span className="block text-xs text-slate-400">
                  {tx('לא יופיע ברשימת העובדים ולא ישובץ לעבודות')}
                </span>
              )}
            </button>
          ))}
          <p className="pt-1 text-sm text-slate-300">{tx('או לא זמין לכמה ימים:')}</p>
          {ABSENCES.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setKind(a.id);
                setFrom(todayIso());
                setTo("");
                setRangeValid({ from: true, to: false });
                setStep("range");
              }}
              className={`${choice} border-slate-700 text-slate-200`}
            >
              {a.name}
            </button>
          ))}
          <p className="text-xs text-slate-400">
            {tx('בימים האלה העובד לא ישובץ לעבודות, והכרטיס שלו יראה את המצב.')}
          </p>
        </div>
      )}
      {step === "range" && (
        <>
          <p className="text-sm text-slate-300">
            {tx('{v}: באילו ימים?', { v: ABSENCES.find((a) => a.id === kind)?.name })}</p>
          {/* Three ways: a stretch of days, the same weekdays every week, or days picked on a calendar. */}
          <div role="tablist" aria-label={tx('איך לסמן')} className="grid grid-cols-3 rounded-xl bg-slate-900 p-1">
            {ABSENCE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={`min-h-11 min-w-0 rounded-lg px-1 text-xs leading-tight font-medium [overflow-wrap:anywhere] ${mode === m.id ? "bg-slate-700 text-slate-50" : "text-slate-400"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === "range" && (
            <>
              <DateField
                label={tx('מתאריך')}
                value={from}
                required
                onChange={(v, ok) => {
                  setFrom(v);
                  setRangeValid((r) => ({ ...r, from: ok }));
                }}
              />
              <DateField
                label={tx('עד תאריך (כולל)')}
                value={to}
                min={from || todayIso()}
                required
                onChange={(v, ok) => {
                  setTo(v);
                  setRangeValid((r) => ({ ...r, to: ok }));
                }}
              />
            </>
          )}
          {mode === "weekly" && (
            <>
              <div className="flex flex-wrap gap-2" aria-label={tx('ימים בשבוע')}>
                {DAY_NAMES.map((name, d) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={weekdays.includes(d)}
                    onClick={() => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]))}
                    className={`min-h-11 rounded-xl border px-3 text-sm ${weekdays.includes(d) ? "border-sky-500 bg-sky-600 text-white" : "border-slate-700 text-slate-200"}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <DateField
                label={tx('עד תאריך (לא חובה; ריק = בלי סוף)')}
                value={to}
                min={todayIso()}
                onChange={(v, ok) => {
                  setTo(v);
                  setRangeValid((r) => ({ ...r, to: ok || !v }));
                }}
              />
            </>
          )}
          {mode === "days" && (
            <>
              <MonthDays
                min={todayIso()}
                selected={picked}
                onToggle={(day) => setPicked((p) => (p.includes(day) ? p.filter((x) => x !== day) : [...p, day]))}
              />
              <p className="text-xs text-slate-400" aria-live="polite">
                {picked.length ? tx('סומנו {v}', { v: picked.length === 1 ? tx('יום אחד') : tx('{length} ימים', { length: picked.length }) }) : tx('לחץ על הימים בלוח')}
              </p>
            </>
          )}
          <button
            type="button"
            disabled={
              mode === "range"
                ? !from || !to || !rangeValid.from || !rangeValid.to || to < from
                : mode === "weekly"
                  ? !weekdays.length || (!!to && !rangeValid.to)
                  : !picked.length
            }
            onClick={() => {
              const base = { kind } as const;
              onAbsence(
                mode === "range"
                  ? [{ ...base, id: newId(), when: "dates", from, to }]
                  : mode === "weekly"
                    ? [{ ...base, id: newId(), when: "weekdays", weekdays: [...weekdays].sort(), from: todayIso(), ...(to ? { to } : {}) }]
                    : daysToRanges(picked).map((r) => ({ ...base, id: newId(), when: "dates" as const, ...r })),
              );
              close();
            }}
            className="min-h-11 w-full rounded-xl bg-sky-600 text-sm font-medium text-white disabled:opacity-40"
          >
            {tx('אישור')}
          </button>
        </>
      )}
      {step === "date" && (
        <>
          <DateField
            label={tx('במחלה עד (כולל היום הזה)')}
            value={sickUntil}
            min={todayIso()}
            required
            onChange={(v, ok) => {
              setSickUntil(v);
              setValid(ok);
            }}
          />
          <button
            type="button"
            disabled={!sickUntil || !valid}
            onClick={() => {
              onPick("sick", sickUntil);
              close();
            }}
            className="min-h-11 w-full rounded-xl bg-sky-600 text-sm font-medium text-white disabled:opacity-40"
          >
            {tx('אישור')}
          </button>
        </>
      )}
    </Sheet>
  );
}
