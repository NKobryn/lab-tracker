// Фронтенд трекера: звертається до backend через fetch і малює сторінку

const STATUS = { not_done: "Не здано", in_progress: "В роботі", done: "Здано" };
const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

// Іконки (SVG), щоб не використовувати емодзі
const ICON = {
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v10M3 8h10"/></svg>',
  star: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
};

let view = "week";   // "week", "all" або id предмета
let subjects = [];   // предмети з backend
let lastRequest = 0; // номер останнього запиту (щоб старі відповіді не перезаписали нові)

// ---------- Запити до backend ----------

async function api(method, url, body) {
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    // FastAPI повертає текст помилки в полі detail
    const message = typeof data.detail === "string" ? data.detail : "Перевір введені дані";
    toast(message, true);
    throw new Error(message);
  }
  return data;
}

// ---------- Допоміжні функції ----------

function esc(text) {
  // екрануємо текст, який ввела користувачка, щоб він не зламав HTML
  return String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function toast(text, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.className = isError ? "toast error" : "toast";
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.add("hidden"), 2500);
}

function daysLeft(deadline) {
  // скільки днів до дедлайну (від'ємне число — дедлайн минув)
  const d = new Date(deadline + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function deadlineButton(lab) {
  // текст і колір кнопки дедлайну
  if (!lab.deadline) return `<button class="deadline-btn none" data-action="deadline">Додати дедлайн</button>`;
  const d = new Date(lab.deadline + "T00:00:00");
  let text = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  let cls = "";
  if (lab.status !== "done") {
    const n = daysLeft(lab.deadline);
    if (n < 0) { text += ` · прострочено`; cls = "overdue"; }
    else if (n === 0) { text += ` · сьогодні`; cls = "soon"; }
    else if (n <= 3) { text += ` · через ${n} дн.`; cls = "soon"; }
  }
  return `<button class="deadline-btn ${cls}" data-action="deadline">${text}</button>`;
}

function subjectName(id) {
  const s = subjects.find((s) => s.id === id);
  return s ? s.name : "";
}

function byDeadline(a, b) {
  // спершу нездані, далі за дедлайном (без дедлайну — в кінці)
  if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
  return (a.deadline || "9999").localeCompare(b.deadline || "9999");
}

function stacked(done, inProgress, total) {
  // смуга прогресу з трьох частин
  if (!total) return `<div class="stacked"></div>`;
  const seg = (n, cls) => `<div class="seg ${cls}" style="width:${(n * 100) / total}%"></div>`;
  return `<div class="stacked">${seg(done, "done")}${seg(inProgress, "in_progress")}${seg(total - done - inProgress, "not_done")}</div>`;
}

// ---------- Діалогове вікно (форми і підтвердження) ----------

function openDialog({ title, message = "", fields = [], okText = "Зберегти", danger = false }) {
  const dialog = document.getElementById("dialog");
  dialog.innerHTML = `
    <form method="dialog">
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${fields.map((f) => `
        <label class="field">${esc(f.label)}
          <input name="${f.name}" type="${f.type || "text"}" value="${esc(f.value)}" ${f.required ? "required" : ""}>
        </label>`).join("")}
      <div class="dialog-actions">
        <button class="btn" value="cancel" formnovalidate>Скасувати</button>
        <button class="btn ${danger ? "danger" : "primary"}" value="ok">${esc(okText)}</button>
      </div>
    </form>`;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "ok") return resolve(null);
      const data = {};
      fields.forEach((f) => (data[f.name] = dialog.querySelector(`[name=${f.name}]`).value.trim()));
      resolve(data);
    }, { once: true });
  });
}

// ---------- Випадне меню біля кнопки ----------

const popover = document.getElementById("popover");

function openPopover(anchor, html, onClick) {
  popover.innerHTML = html;
  popover.onclick = onClick;
  popover.classList.remove("hidden");
  // ставимо меню під кнопкою, але не за межами екрана
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 8);
  const below = r.bottom + 6 + popover.offsetHeight < window.innerHeight;
  popover.style.left = `${Math.max(8, left)}px`;
  popover.style.top = below ? `${r.bottom + 6}px` : `${r.top - popover.offsetHeight - 6}px`;
}

function closePopover() {
  popover.classList.add("hidden");
  popover.innerHTML = "";
  popover.anchor = null;
}

document.addEventListener("mousedown", (e) => {
  if (!popover.contains(e.target) && !e.target.closest("[data-action]")) closePopover();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });
window.addEventListener("scroll", closePopover, true);
window.addEventListener("resize", closePopover);

function menu(items) {
  // items: [{ value, label, dot, checked, danger }] або "sep" для розділювача
  return items.map((i) => i === "sep" ? `<div class="menu-sep"></div>` : `
    <button class="menu-item ${i.danger ? "danger" : ""}" data-value="${i.value}">
      ${i.dot ? `<i class="dot ${i.dot}"></i>` : ""}${esc(i.label)}
      ${i.checked ? `<span class="check-mark">${ICON.check}</span>` : ""}
    </button>`).join("");
}

// ---------- Бічна панель ----------

async function loadSidebar() {
  const [p, list] = await Promise.all([api("GET", "/api/progress"), api("GET", "/api/subjects")]);
  subjects = list;

  document.getElementById("week-count").textContent = p.this_week || "";
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));

  const ul = document.getElementById("subject-list");
  ul.innerHTML = subjects.length
    ? subjects.map((s) => `
        <li data-id="${s.id}" class="${s.id === view ? "active" : ""}">
          <span>${esc(s.name)}</span><span class="count">${s.done}/${s.total}</span>
        </li>`).join("")
    : `<li class="empty-hint">Ще немає предметів</li>`;

  document.getElementById("progress").innerHTML = `
    <div class="progress-row"><span class="muted">Загальний прогрес</span><b>${p.percent}%</b></div>
    ${stacked(p.done, p.in_progress, p.total)}
    <div class="legend">
      <div><span>Здано</span><span>${p.done} з ${p.total}</span></div>
      <div><span>В роботі</span><span>${p.in_progress}</span></div>
      <div><span>Не здано</span><span>${p.not_done}</span></div>
      ${p.overdue ? `<div class="overdue"><span>Прострочено</span><span>${p.overdue}</span></div>` : ""}
    </div>`;
}

document.querySelector(".nav").addEventListener("click", (e) => {
  const b = e.target.closest(".nav-item");
  if (b) go(b.dataset.view);
});
document.getElementById("subject-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) go(li.dataset.id);
});

const newSubjectBtn = document.getElementById("new-subject");
newSubjectBtn.innerHTML = ICON.plus;
newSubjectBtn.addEventListener("click", async () => {
  const data = await openDialog({
    title: "Новий предмет", okText: "Додати",
    fields: [
      { name: "name", label: "Назва", required: true },
      { name: "teacher", label: "Викладач (необов'язково)" },
    ],
  });
  if (!data) return;
  const s = await api("POST", "/api/subjects", data);   // Create
  toast("Предмет додано");
  go(s.id);
});

// ---------- Рядок лабораторної ----------

function labRow(lab, showSubject) {
  return `
    <div class="lab ${lab.status === "done" ? "is-done" : ""}" data-id="${lab.id}">
      <span class="num">${lab.number}</span>
      <span class="title">${esc(lab.title)}${showSubject ? `<span class="subject">${esc(subjectName(lab.subject_id))}</span>` : ""}</span>
      ${deadlineButton(lab)}
        <button class="status-btn ${lab.status}" data-action="status"><i class="dot ${lab.status}"></i>${STATUS[lab.status]}</button>
      <button class="icon-btn star ${lab.this_week ? "on" : ""}" data-action="star"
              title="${lab.this_week ? "Прибрати з цього тижня" : "Здати цього тижня"}">${ICON.star}</button>
      <button class="icon-btn" data-action="more" title="Дії">${ICON.more}</button>
    </div>`;
}

function labsList(list, showSubject) {
  return `<div class="list">${list.map((l) => labRow(l, showSubject)).join("")}</div>`;
}

// ---------- Розділ «Цей тиждень» ----------

async function renderWeek(main) {
  const list = (await api("GET", "/api/labs?this_week=true")).sort(byDeadline);
  const left = list.filter((l) => l.status !== "done").length;
  main.innerHTML = `
    <div class="view-head"><div>
      <h1>Цей тиждень</h1>
      <div class="subtitle">${list.length ? `Лишилось здати ${left} з ${list.length}` : "План на тиждень порожній"}</div>
    </div></div>
    ${list.length ? labsList(list, true) : `
      <div class="empty"><p>Познач зірочкою лабораторні, які хочеш здати цього тижня.</p>
      <p><button class="btn" data-go="all">Перейти до всіх лабораторних</button></p></div>`}`;
  main.labs = list;
}


// ---------- Розділ «Усі лабораторні»: таблиця з фільтрами ----------

const filters = { q: "", subjects: [], status: "", overdue: false };

async function renderAll(main) {
  main.innerHTML = `
    <div class="view-head"><div><h1>Усі лабораторні</h1></div></div>
    <div class="filters">
      <input id="f-q" placeholder="Пошук у темі" value="${esc(filters.q)}">
      <select id="f-status"><option value="">Усі статуси</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === filters.status ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <label class="check"><input type="checkbox" id="f-overdue" ${filters.overdue ? "checked" : ""}> Лише прострочені</label>
    </div>
    <div class="chips" id="f-subjects">
      <button class="chip ${filters.subjects.length ? "" : "on"}" data-subject="">Усі предмети</button>
      ${subjects.map((s) => `<button class="chip ${filters.subjects.includes(s.id) ? "on" : ""}" data-subject="${s.id}">${esc(s.name)}</button>`).join("")}
    </div>
    <div id="results"></div>`;

  const read = () => {
    filters.q = main.querySelector("#f-q").value.trim();
    filters.status = main.querySelector("#f-status").value;
    filters.overdue = main.querySelector("#f-overdue").checked;
    loadResults(main);
  };
  main.querySelector("#f-q").addEventListener("input", read);
  main.querySelectorAll("#f-status, #f-overdue").forEach((el) => el.addEventListener("change", read));

  // предмети вибираються кнопками: можна увімкнути кілька, «Усі предмети» скидає вибір
  main.querySelector("#f-subjects").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const id = chip.dataset.subject;
    if (!id) filters.subjects = [];
    else if (filters.subjects.includes(id)) filters.subjects = filters.subjects.filter((x) => x !== id);
    else filters.subjects.push(id);
    main.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on",
      c.dataset.subject ? filters.subjects.includes(c.dataset.subject) : !filters.subjects.length));
    loadResults(main);
  });
  await loadResults(main);
}

async function loadResults(main) {
  // збираємо параметри фільтра в рядок запиту: /api/labs?subject_id=...&subject_id=...&status=done
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  filters.subjects.forEach((id) => params.append("subject_id", id));
  if (filters.status) params.set("status", filters.status);
  if (filters.overdue) params.set("overdue", "true");

  const request = ++lastRequest;
  const list = await api("GET", "/api/labs?" + params);
  if (request !== lastRequest) return; // прийшла відповідь на старий запит
  // у таблиці сортуємо за предметом, а в предметі — за номером
  list.sort((a, b) => subjectName(a.subject_id).localeCompare(subjectName(b.subject_id)) || a.number - b.number);
  main.labs = list;
  main.querySelector("#results").innerHTML = list.length
    ? `<p class="found">Знайдено: ${list.length}</p>${labsTable(list)}`
    : `<div class="empty"><p>Нічого не знайдено. Зміни умови фільтра.</p></div>`;
}

function labsTable(list) {
  // таблиця: предмет, номер, дедлайн, статус (тема видна при наведенні)
  return `
    <div class="list table">
      <div class="table-head"><span>Предмет</span><span>№</span><span>Тема</span><span>Дедлайн</span><span>Статус</span><span></span><span></span></div>      ${list.map((lab) => `
        <div class="lab table-row ${lab.status === "done" ? "is-done" : ""}" data-id="${lab.id}">
          <span class="subject-cell">${esc(subjectName(lab.subject_id))}</span>
          <span class="num-cell">${lab.number}</span>
          <span class="title">${esc(lab.title)}</span>
          <span>${deadlineButton(lab)}</span>
          <button class="status-btn ${lab.status}" data-action="status"><i class="dot ${lab.status}"></i>${STATUS[lab.status]}</button>
          <button class="icon-btn star ${lab.this_week ? "on" : ""}" data-action="star"
                  title="${lab.this_week ? "Прибрати з цього тижня" : "Здати цього тижня"}">${ICON.star}</button>
          <button class="icon-btn" data-action="more" title="Дії">${ICON.more}</button>
        </div>`).join("")}
    </div>`;
}


// ---------- Розділ предмета ----------

async function renderSubject(main, s) {
  const list = await api("GET", "/api/labs?subject_id=" + s.id);
  list.sort((a, b) => a.number - b.number);
  const next = list.length ? Math.max(...list.map((l) => l.number)) + 1 : 1;
  main.innerHTML = `
    <div class="view-head">
      <div>
        <h1>${esc(s.name)}</h1>
        <div class="subtitle">${s.teacher ? esc(s.teacher) + " · " : ""}здано ${s.done} з ${s.total}</div>
        <div class="subject-bar">${stacked(s.done, s.in_progress, s.total)}</div>
      </div>
      <button class="icon-btn" data-action="subject-more" title="Дії з предметом">${ICON.more}</button>
    </div>
    ${list.length ? labsList(list, false) : `<div class="empty"><p>У предметі ще немає лабораторних. Додай першу нижче.</p></div>`}
    <form class="add-row" id="add-lab">
      <input name="number" type="number" min="1" value="${next}" title="Номер" required>
      <input name="title" placeholder="Тема лабораторної" required>
      <input name="deadline" type="date" title="Дедлайн (необов'язково)">
      <button class="btn primary">Додати</button>
    </form>`;
  main.labs = list;

  main.querySelector("#add-lab").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    await api("POST", "/api/labs", {   // Create
      subject_id: s.id,
      number: Number(f.number.value),
      title: f.title.value.trim(),
      deadline: f.deadline.value || null,
    });
    toast("Лабораторну додано");
    await refresh();
    document.querySelector("#add-lab [name=title]").focus();
  });
}

// ---------- Дії в рядку лабораторної ----------

const main = document.getElementById("view");

main.addEventListener("click", async (e) => {
  const goBtn = e.target.closest("[data-go]");
  if (goBtn) return go(goBtn.dataset.go);

  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (!popover.classList.contains("hidden") && popover.anchor === btn) return closePopover();

  if (action === "subject-more") return subjectMenu(btn);

  const lab = main.labs.find((l) => l.id === btn.closest(".lab").dataset.id);
  const update = async (changes, message) => {   // Update
    closePopover();
    await api("PUT", "/api/labs/" + lab.id, changes);
    if (message) toast(message);
    refresh();
  };

  if (action === "star") {
    update({ this_week: !lab.this_week }, lab.this_week ? "Прибрано з цього тижня" : "Додано на цей тиждень");
  }

  if (action === "status") {
    openPopover(btn, menu(Object.entries(STATUS).map(([k, v]) =>
      ({ value: k, label: v, dot: k, checked: k === lab.status }))), (ev) => {
      const item = ev.target.closest(".menu-item");
      if (item && item.dataset.value !== lab.status) update({ status: item.dataset.value });
      else if (item) closePopover();
    });
    popover.anchor = btn;
  }

  if (action === "deadline") {
    openPopover(btn, `
      <form class="date-form">
        <input type="date" name="d" value="${lab.deadline || ""}">
        <div class="row">
          ${lab.deadline ? `<button type="button" class="btn" data-clear>Прибрати</button>` : ""}
          <button class="btn primary">Зберегти</button>
        </div>
      </form>`, (ev) => {
      if (ev.target.closest("[data-clear]")) update({ deadline: null }, "Дедлайн прибрано");
    });
    popover.anchor = btn;
    popover.querySelector("form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      update({ deadline: ev.target.d.value || null }, "Дедлайн збережено");
    });
    popover.querySelector("input").focus();
  }

  if (action === "more") {
    openPopover(btn, menu([
      { value: "edit", label: "Змінити" }, "sep", { value: "delete", label: "Видалити", danger: true },
    ]), async (ev) => {
      const item = ev.target.closest(".menu-item");
      if (!item) return;
      closePopover();
      if (item.dataset.value === "edit") editLab(lab);
      if (item.dataset.value === "delete") deleteLab(lab);
    });
    popover.anchor = btn;
  }
});

async function editLab(lab) {
  const data = await openDialog({
    title: "Змінити лабораторну",
    fields: [
      { name: "number", label: "Номер", type: "number", value: lab.number, required: true },
      { name: "title", label: "Тема", value: lab.title, required: true },
    ],
  });
  if (!data) return;
  await api("PUT", "/api/labs/" + lab.id, { number: Number(data.number), title: data.title });  // Update
  toast("Лабораторну змінено");
  refresh();
}

async function deleteLab(lab) {
  const ok = await openDialog({
    title: "Видалити лабораторну?",
    message: `№${lab.number} «${lab.title}» буде видалено назавжди.`,
    okText: "Видалити", danger: true,
  });
  if (!ok) return;
  await api("DELETE", "/api/labs/" + lab.id);   // Delete
  toast("Лабораторну видалено");
  refresh();
}

// ---------- Дії з предметом ----------

function subjectMenu(btn) {
  const s = subjects.find((s) => s.id === view);
  openPopover(btn, menu([
    { value: "edit", label: "Змінити предмет" }, "sep", { value: "delete", label: "Видалити предмет", danger: true },
  ]), async (ev) => {
    const item = ev.target.closest(".menu-item");
    if (!item) return;
    closePopover();
    if (item.dataset.value === "edit") {
      const data = await openDialog({
        title: "Змінити предмет",
        fields: [
          { name: "name", label: "Назва", value: s.name, required: true },
          { name: "teacher", label: "Викладач", value: s.teacher },
        ],
      });
      if (!data) return;
      await api("PUT", "/api/subjects/" + s.id, data);   // Update
      toast("Предмет змінено");
      refresh();
    }
    if (item.dataset.value === "delete") {
      const ok = await openDialog({
        title: `Видалити «${s.name}»?`,
        message: s.total ? `Разом з предметом буде видалено лабораторних: ${s.total}.` : "Предмет не має лабораторних.",
        okText: "Видалити", danger: true,
      });
      if (!ok) return;
      await api("DELETE", "/api/subjects/" + s.id);   // Delete (разом з лабораторними)
      toast("Предмет видалено");
      go("week");
    }
  });
  popover.anchor = btn;
}

// ---------- Перемикання розділів ----------

function go(target) {
  view = target;
  closePopover();
  refresh();
}

async function refresh() {
  await loadSidebar();
  const s = subjects.find((s) => s.id === view);
  if (view === "all") await renderAll(main);
  else if (s) await renderSubject(main, s);
  else await renderWeek(main);
}

refresh();