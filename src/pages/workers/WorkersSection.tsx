import { useState } from "react";
import { ArrowRight, CalendarX, Filter, Phone, UserX, X } from "lucide-react";
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
  GENERAL_ROLE_NAME,
  generalRoleId,
  isActive,
  isGeneralRole,
  isIsraeliId,
  isIsraeliMobile,
  newId,
  tagNames,
  telHref,
  upsert,
} from "../../lib/catalog";
import { constraintText, isOver } from "../../lib/constraints";
import { useDriveList } from "../../lib/data/useDriveList";
import { todayIso } from "../../lib/dates";
import { showDate } from "../../lib/shifts";
import { DateField } from "../../components/DateField";
import type { Worker, WorkerStatus } from "../../types/models";
import { AddButton, EditMark, EmptyState } from "./common";
import { ConstraintsField } from "./ConstraintsField";
import { RequestSheet } from "./RequestSheet";
import { JoinButton, JoinPending } from "./JoinSection";

const blankWorker = (): Worker => ({
  id: newId(),
  firstName: "",
  lastName: "",
  roleIds: [],
  certificationIds: [],
  constraints: [],
  status: "active",
});

const STATUSES: { id: WorkerStatus; name: string }[] = [
  { id: "active", name: "פעיל" },
  { id: "sick", name: "במחלה עד תאריך" },
  { id: "inactive", name: "לא פעיל" },
];

const STATUS_COLOR: Record<WorkerStatus, string> = {
  active: "text-emerald-400",
  sick: "text-orange-400",
  inactive: "text-red-400",
};

const statusText = (w: Worker) =>
  w.status === "sick" && w.sickUntil
    ? `במחלה עד ${showDate(w.sickUntil)}`
    : w.status === "inactive"
      ? "לא פעיל"
      : "פעיל";

/** Sick until a day that has passed: active again, without anyone having to change it. */
const sickNow = (w: Worker, today: string) =>
  w.status === "sick" && !!w.sickUntil && w.sickUntil >= today;

const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export function WorkersSection() {
  const workers = useDriveList("workers");
  const roles = useDriveList("roles");
  const certs = useDriveList("certifications");
  const [editing, setEditing] = useState<Worker | null>(null);
  // Set while the open form came from a worker's answer: run once it is saved (removes the answer).
  const [onSaved, setOnSaved] = useState<(() => void) | null>(null);
  const edit = (w: Worker | null, saved?: () => void) => {
    setEditing(w);
    setOnSaved(() => saved ?? null);
  };
  const review = (w: Worker, saved: () => void) => edit(w, saved);
  const [filterOpen, setFilterOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [certFilter, setCertFilter] = useState<string[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const filtering = roleFilter.length + certFilter.length > 0;
  const inactiveCount = workers.items.filter((w) => !isActive(w)).length;
  // Inactive workers are kept (old shifts and reports name them) but listed only behind their own button.
  const listed = workers.items.filter((w) => isActive(w) !== showInactive);
  const shown = filterWorkers(
    listed,
    roleFilter,
    certFilter,
    generalRoleId(roles.items),
  ).sort((a, b) => fullName(a).localeCompare(fullName(b), "he"));
  const filterNames = [
    ...tagNames(roleFilter, roles.items),
    ...tagNames(certFilter, certs.items),
  ];

  if (workers.items.length === 0) {
    return (
      <>
        <JoinPending onReview={review} />
        <EmptyState
          text="כאן נמצאת רשימת העובדים שלך. לכל עובד מסמנים את התפקידים וההסמכות שלו, ואז אפשר לחפש לפיהם."
          addLabel="הוספת עובד"
          onAdd={() => edit(blankWorker())}
        />
        <div className="mt-3">
          <JoinButton />
        </div>
        <WorkerSheet editing={editing} onClose={() => edit(null)} onSaved={onSaved} />
      </>
    );
  }

  return (
    <>
      <div className="mb-3 space-y-2">
        {showInactive ? (
          <button
            type="button"
            onClick={() => setShowInactive(false)}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-sky-500 px-3 text-start text-sm text-sky-300"
          >
            <ArrowRight size={16} aria-hidden className="shrink-0" />
            חזרה לעובדים הפעילים
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRequesting(true)}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-emerald-500/50 px-3 text-start text-sm text-emerald-300"
          >
            <CalendarX size={16} aria-hidden className="shrink-0" />
            בקשת אילוצים מהעובדים בוואטסאפ
          </button>
        )}
        {!showInactive && <JoinButton />}
        <button
          type="button"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
          className={`flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-start text-sm ${
            filtering
              ? "border-sky-500 text-sky-300"
              : "border-slate-700 text-slate-300"
          }`}
        >
          <Filter size={16} aria-hidden className="shrink-0" />
          {filtering
            ? `מסנן לפי: ${filterNames.join(", ")}`
            : "חיפוש עובדים לפי תפקיד או הסמכה"}
        </button>
        {filterOpen && (
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
            <p className="text-xs text-slate-400">
              יוצגו רק עובדים שיש להם את כל מה שסימנת.
            </p>
            {roles.items.length > 0 && (
              <div className="space-y-1">
                <span className="text-sm text-slate-300">תפקידים</span>
                <Chips
                  options={roles.items}
                  selected={roleFilter}
                  onToggle={(id) => setRoleFilter((f) => toggle(f, id))}
                />
              </div>
            )}
            {certs.items.length > 0 && (
              <div className="space-y-1">
                <span className="text-sm text-slate-300">הסמכות</span>
                <Chips
                  options={certs.items}
                  selected={certFilter}
                  onToggle={(id) => setCertFilter((f) => toggle(f, id))}
                />
              </div>
            )}
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setRoleFilter([]);
                  setCertFilter([]);
                }}
                className="flex min-h-11 items-center gap-1 text-sm text-slate-300"
              >
                <X size={16} aria-hidden />
                ניקוי הסינון
              </button>
            )}
          </div>
        )}
      </div>

      {!showInactive && <JoinPending onReview={review} />}
      {showInactive && (
        <h2 className="mb-1 text-lg font-semibold">עובדים לא פעילים</h2>
      )}
      <p className="mb-2 text-sm text-slate-400" aria-live="polite">
        {filtering
          ? `${countText(shown.length, "עובד אחד מתאים", "עובדים מתאימים")} מתוך ${listed.length}`
          : countText(
              listed.length,
              showInactive ? "עובד לא פעיל אחד" : "עובד פעיל אחד",
              showInactive ? "עובדים לא פעילים" : "עובדים פעילים",
            )}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          {filtering
            ? "אין עובד שיש לו את כל מה שסימנת."
            : showInactive
              ? "אין עובדים לא פעילים."
              : "כל העובדים מסומנים כלא פעילים."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((w) => (
            <li key={w.id}>
              <WorkerCard worker={w} onOpen={() => edit(w)} />
            </li>
          ))}
        </ul>
      )}
      {!showInactive && inactiveCount > 0 && (
        <button
          type="button"
          onClick={() => setShowInactive(true)}
          className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-700 px-3 text-start text-sm text-slate-300"
        >
          <UserX size={16} aria-hidden className="shrink-0" />
          עובדים לא פעילים ({inactiveCount})
        </button>
      )}
      <AddButton label="הוספת עובד" onClick={() => edit(blankWorker())} />
      <WorkerSheet editing={editing} onClose={() => edit(null)} onSaved={onSaved} />
      <RequestSheet open={requesting} onClose={() => setRequesting(false)} />
    </>
  );
}

function WorkerCard({
  worker: w,
  onOpen,
}: {
  worker: Worker;
  onOpen: () => void;
}) {
  const roles = useDriveList("roles");
  const certs = useDriveList("certifications");
  const departments = useDriveList("departments");
  // Every worker is "כללי"; it is shown only when they hold no other role, so the card is never empty.
  const specific = tagNames(
    w.roleIds,
    roles.items.filter((r) => !isGeneralRole(r)),
  );
  const roleList = specific.length ? specific : [GENERAL_ROLE_NAME];
  const certList = tagNames(w.certificationIds, certs.items);
  const department = departments.items.find(
    (d) => d.id === w.departmentId,
  )?.name;
  const today = todayIso();
  const active = w.constraints.filter((c) => !isOver(c, today));

  const dial = telHref(w.mobilePhone);

  return (
    <div className="flex items-stretch rounded-2xl border border-slate-800 bg-slate-900">
      <button
        type="button"
        onClick={onOpen}
        className="relative min-w-0 flex-1 space-y-2 p-4 pe-9 text-start"
      >
        <EditMark />
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{fullName(w)}</span>
          {w.mobilePhone && (
            <span dir="ltr" className="text-sm text-slate-400">
              {w.mobilePhone}
            </span>
          )}
        </span>
        {sickNow(w, today) && (
          <span className="block w-fit rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-200">
            במחלה עד {showDate(w.sickUntil!)}
          </span>
        )}
        {!isActive(w) && (
          <span className="block w-fit rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-200">
            לא פעיל
          </span>
        )}
        <span className="flex flex-wrap gap-1">
          {department && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-200">
              {department}
            </span>
          )}
          {roleList.map((n) => (
            <span
              key={n}
              className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
            >
              {n}
            </span>
          ))}
          {certList.map((n) => (
            <span
              key={n}
              className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-200"
            >
              {n}
            </span>
          ))}
        </span>
        {active.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {active.slice(0, 2).map((c) => (
              <span
                key={c.id}
                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200"
              >
                {constraintText(c)}
              </span>
            ))}
            {active.length > 2 && (
              <span className="px-1 text-xs text-amber-200">
                ועוד {active.length - 2}
              </span>
            )}
          </span>
        )}
      </button>
      {dial && (
        <a
          href={dial}
          aria-label={`חיוג אל ${fullName(w)}`}
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
          ? "עריכת עובד"
          : "עובד חדש"
      }
      onClose={onClose}
      locked={workers.saving}
    >
      {editing && <WorkerForm key={editing.id} worker={editing} onDone={onClose} onSaved={onSaved ?? undefined} />}
    </Sheet>
  );
}

const PHONES = [
  ["mobilePhone", "טלפון נייד (חובה)"],
  ["homePhone", "טלפון בבית"],
  ["emergencyPhone1", "טלפון חירום 1"],
  ["emergencyPhone2", "טלפון חירום 2"],
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
  const roles = useDriveList("roles");
  const certs = useDriveList("certifications");
  const departments = useDriveList("departments");
  // A sickness that has ended opens as active, so the form shows what is true today.
  const [draft, setDraft] = useState<Worker>(() =>
    worker.status === "sick" && !sickNow(worker, todayIso())
      ? { ...worker, status: "active", sickUntil: undefined }
      : worker,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [birthDateValid, setBirthDateValid] = useState(true);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const exists = workers.items.some((w) => w.id === worker.id);
  const specificRoles = roles.items.filter((r) => !isGeneralRole(r));

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
      ? "צריך למלא שם פרטי"
      : !draft.lastName.trim()
        ? "צריך למלא שם משפחה"
        : !draft.mobilePhone?.trim()
          ? "צריך למלא טלפון נייד"
          : !isIsraeliMobile(draft.mobilePhone)
            ? "הטלפון הנייד לא תקין. צריך 10 ספרות שמתחילות ב-05, למשל 050-1234567"
            : draft.idNumber?.trim() && !isIsraeliId(draft.idNumber)
              ? "תעודת הזהות לא תקינה. צריך 9 ספרות, למשל 012345678"
              : !birthDateValid
                ? "תאריך הלידה לא תקין"
                : draft.status === "sick" && !draft.sickUntil
                  ? "צריך לבחור עד איזה תאריך העובד במחלה"
                  : null;
    setError(err);
    if (err) return;
    const clean: Worker = {
      ...draft,
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
      <ConstraintsField
        value={draft.constraints}
        onChange={(constraints) => setDraft((d) => ({ ...d, constraints }))}
        onNotes={(text) =>
          setDraft((d) => ({
            ...d,
            notes: [d.notes?.trim(), text].filter(Boolean).join("\n"),
          }))
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="שם פרטי (חובה)">
          <input
            autoFocus
            value={draft.firstName}
            onChange={set("firstName")}
            className={inputClass}
          />
        </Field>
        <Field label="שם משפחה (חובה)">
          <input
            value={draft.lastName}
            onChange={set("lastName")}
            className={inputClass}
          />
        </Field>
      </div>

      {/* Small on purpose: a line of its own under the name, not a full form row. */}
      <p className="-mt-3 text-xs text-slate-400">
        סטטוס:{" "}
        <button
          type="button"
          onClick={() => setStatusOpen(true)}
          className={`py-1 font-semibold ${STATUS_COLOR[draft.status ?? "active"]}`}
        >
          {statusText(draft)}
        </button>
      </p>
      <StatusSheet
        open={statusOpen}
        worker={draft}
        onClose={() => setStatusOpen(false)}
        onPick={(status, sickUntil) =>
          setDraft((d) => ({ ...d, status, sickUntil }))
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="ת.ז">
          <input
            dir="ltr"
            inputMode="numeric"
            maxLength={11}
            value={draft.idNumber ?? ""}
            onChange={set("idNumber")}
            className={`${inputClass} text-right`}
          />
        </Field>
        <Field label="מספר אישי">
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
        <span className="text-sm text-slate-300">מחלקה</span>
        {departments.items.length ? (
          <Chips
            options={departments.items}
            selected={draft.departmentId ? [draft.departmentId] : []}
            // One department at most: tapping the chosen one again clears it.
            onToggle={(id) =>
              setDraft((d) => ({
                ...d,
                departmentId: d.departmentId === id ? undefined : id,
              }))
            }
          />
        ) : (
          <p className="text-sm text-amber-300">
            עוד אין מחלקות. אפשר להוסיף אותן בהגדרות, "מחלקות".
          </p>
        )}
      </div>

      <div className="space-y-1">
        <span className="text-sm text-slate-300">תפקידים</span>
        <p className="text-xs text-slate-400">
          כל עובד הוא גם "כללי", בלי לסמן.
        </p>
        {specificRoles.length ? (
          <Chips
            options={specificRoles}
            selected={draft.roleIds}
            onToggle={(id) =>
              setDraft((d) => ({ ...d, roleIds: toggle(d.roleIds, id) }))
            }
          />
        ) : (
          <p className="text-sm text-amber-300">
            עוד אין תפקידים מלבד "כללי". אפשר להוסיף אותם בלשונית "תפקידים".
          </p>
        )}
      </div>
      <div className="space-y-1">
        <span className="text-sm text-slate-300">הסמכות</span>
        {certs.items.length ? (
          <Chips
            options={certs.items}
            selected={draft.certificationIds}
            onToggle={(id) =>
              setDraft((d) => ({
                ...d,
                certificationIds: toggle(d.certificationIds, id),
              }))
            }
          />
        ) : (
          <p className="text-sm text-amber-300">
            עוד אין הסמכות. אפשר להוסיף אותן בלשונית "הסמכות".
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
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
                  className={`${inputClass} min-w-0 text-right`}
                />
                {/* Always shown so every phone field visibly has a call button; inactive until a number is typed. */}
                {dial ? (
                  <a
                    href={dial}
                    aria-label={`חיוג: ${label}`}
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
        label="תאריך לידה"
        value={draft.birthDate ?? ""}
        min="1900-01-01"
        max={todayIso()}
        onChange={(birthDate, valid) => {
          setDraft((d) => ({ ...d, birthDate }));
          setBirthDateValid(valid);
        }}
      />
      <Field label="כתובת">
        <input
          value={draft.address ?? ""}
          onChange={set("address")}
          className={inputClass}
        />
      </Field>
      <Field label="הערות">
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
        deleteWarning={`למחוק את ${fullName(worker)}? אי אפשר לבטל את זה.`}
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
}: {
  open: boolean;
  worker: Worker;
  onClose: () => void;
  onPick: (status: WorkerStatus, sickUntil?: string) => void;
}) {
  const [step, setStep] = useState<"ask" | "pick" | "date">("ask");
  const [sickUntil, setSickUntil] = useState("");
  const [valid, setValid] = useState(false);
  const close = () => {
    setStep("ask");
    setSickUntil("");
    onClose();
  };
  const pick = (status: WorkerStatus) => {
    if (status === "sick") return setStep("date");
    onPick(status);
    close();
  };
  const choice = "min-h-11 w-full rounded-xl border px-3 text-start text-sm";

  return (
    <Sheet open={open} title="סטטוס העובד" onClose={close}>
      {step === "ask" && (
        <>
          <p className="text-sm text-slate-300">
            הסטטוס של {fullName(worker) || "העובד"} עכשיו: {statusText(worker)}. לשנות
            אותו?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="min-h-11 rounded-xl bg-sky-600 text-sm font-medium text-white"
            >
              כן, לשנות
            </button>
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded-xl border border-slate-700 text-sm text-slate-300"
            >
              לא
            </button>
          </div>
        </>
      )}
      {step === "pick" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">לאיזה סטטוס?</p>
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
                  לא יופיע ברשימת העובדים ולא ישובץ לעבודות
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {step === "date" && (
        <>
          <DateField
            label="במחלה עד (כולל היום הזה)"
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
            אישור
          </button>
        </>
      )}
    </Sheet>
  );
}
