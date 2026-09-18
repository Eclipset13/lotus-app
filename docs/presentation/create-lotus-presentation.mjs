import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The requested @oai/artifact-tool is not available in this local installation.
// Keep the generator as an ES module and use the installed PowerPoint COM export
// path so the resulting OOXML remains editable and speaker notes are preserved.
try {
  await import("@oai/artifact-tool");
} catch {
  // Local fallback documented above.
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "docs", "presentation");
const assetDir = path.join(outDir, "assets");
const previewDir = path.join(outDir, "previews");
const pptxPath = path.join(outDir, "lotus-automation-practice.pptx");
const pdfPath = path.join(outDir, "lotus-automation-practice.pdf");
const manifestPath = path.join(outDir, "presentation-manifest.json");

const C = {
  bg: "#FFF9F7",
  pink: "#F4CBC4",
  accent: "#C97D72",
  rose: "#B85D70",
  text: "#342622",
  muted: "#806E68",
  white: "#FFFFFF",
  warm: "#F8E7E2",
  line: "#EAD8D2",
  orange: "#C48357",
  red: "#A45D69",
};

const inch = (n) => n;
const text = (value, x, y, w, h, size = 18, color = C.text, opts = {}) => ({
  type: "text", value, x, y, w, h, size, color,
  font: opts.font || "Arial", bold: !!opts.bold, italic: !!opts.italic,
  align: opts.align || "left", valign: opts.valign || "top",
  margin: opts.margin ?? 0.08,
});
const box = (x, y, w, h, fill, opts = {}) => ({
  type: "box", x, y, w, h, fill, line: opts.line || fill,
  radius: !!opts.radius, transparency: opts.transparency || 0,
});
const line = (x1, y1, x2, y2, color = C.line, width = 1.3, dash = 0) => ({
  type: "line", x1, y1, x2, y2, color, width, dash,
});
const image = (file, x, y, w, h, opts = {}) => ({
  type: "image", file, x, y, w, h, transparency: opts.transparency || 0,
});
const circle = (x, y, d, fill, opts = {}) => ({
  type: "circle", x, y, w: d, h: d, fill, line: opts.line || fill,
});
const chevron = (x, y, w, h, fill, value, size = 14) => ({
  type: "chevron", x, y, w, h, fill, value, size,
});
const footer = (n) => [
  text("LOTUS", 11.85, 7.12, 0.9, 0.18, 9, C.rose, { bold: true, align: "right" }),
  text(String(n).padStart(2, "0"), 0.48, 7.12, 0.35, 0.18, 9, C.muted, { bold: true }),
];
const header = (n, kicker, title) => [
  text(kicker.toUpperCase(), 0.65, 0.48, 4, 0.22, 10, C.rose, { bold: true }),
  text(title, 0.65, 0.78, 11.2, 0.62, 31, C.text, { font: "Georgia", bold: false }),
  line(0.65, 1.52, 12.65, 1.52, C.pink, 1.2),
  ...footer(n),
];
const bulletBlock = (items, x, y, w, size = 18, gap = 0.36, color = C.text) => {
  const out = [];
  items.forEach((item, i) => {
    out.push(circle(x, y + i * gap + 0.06, 0.10, C.accent));
    out.push(text(item, x + 0.22, y + i * gap, w - 0.22, gap - 0.02, size, color));
  });
  return out;
};

const slides = [
  {
    bg: C.bg,
    notes: "Здравствуйте. Я представляю проект Lotus, разработанный в рамках производственной практики. Lotus представляет собой веб-систему для цветочного магазина. Основное внимание в проекте уделено автоматизации внутренних процессов: от оформления заказа и резервирования цветов до работы склада, курьеров, сотрудников и журнала действий.",
    items: [
      image("logo.png", 0.72, 0.42, 1.05, 0.55),
      text("LOTUS", 1.85, 0.50, 1.55, 0.35, 20, C.text, { font: "Georgia", bold: true }),
      text("Автоматизация\nцветочного магазина Lotus", 0.85, 1.55, 6.3, 1.95, 42, C.text, { font: "Georgia" }),
      text("Система управления заказами, складом,\nдоставкой и персоналом", 0.88, 4.08, 5.7, 0.65, 19, C.muted),
      line(0.88, 5.05, 5.65, 5.05, C.pink, 2.2),
      text("Шарифов Тигран\nФилиал МГУ им. М.В. Ломоносова в Душанбе\nПрикладная математика и информатика, 3 курс\n2026", 0.88, 5.30, 5.8, 1.1, 14, C.text),
      box(7.05, 0.86, 5.45, 5.9, C.pink, { line: C.pink, radius: true }),
      circle(7.58, 1.36, 4.45, C.white, { line: C.white }),
      image("lotus-hero-bouquet.png", 7.28, 1.16, 4.9, 4.48),
      text("Система, в которой\nпроцессы магазина связаны\nодной базой данных", 7.55, 6.16, 4.6, 0.48, 14, C.rose, { italic: true, align: "center" }),
    ],
  },
  {
    bg: C.bg,
    notes: "Основная проблема небольшого магазина состоит в том, что данные часто хранятся в разных местах. Заказы могут приниматься в переписке, остатки контролироваться вручную, а доставка обсуждаться отдельно. Это создаёт риск ошибок. Цель Lotus состоит в том, чтобы связать эти процессы и хранить их состояние в одной базе данных.",
    items: [
      ...header(2, "Контекст практики", "Задача автоматизации"),
      text("Без единой системы сотрудники вынуждены\nотдельно контролировать:", 0.72, 1.86, 5.3, 0.78, 18, C.text, { bold: true }),
      ...bulletBlock(["заказы покупателей", "наличие и резерв цветов", "оплату и стоимость доставки", "закупки и поступления", "работу флористов и курьеров", "изменения сотрудников"], 0.82, 2.88, 5.0, 16, 0.34),
      box(0.72, 5.42, 5.55, 0.88, C.warm, { line: C.pink, radius: true }),
      text("Цель: единая система\nдля операций магазина и контроля.", 1.0, 5.64, 5.0, 0.42, 16, C.rose, { bold: true }),
      circle(7.58, 2.18, 2.0, C.warm, { line: C.pink }),
      text("МАГАЗИН", 7.86, 2.89, 1.45, 0.3, 13, C.rose, { bold: true, align: "center" }),
      ...[
        [6.56, 1.65, "Заказы"], [9.83, 1.65, "Склад"], [6.22, 4.28, "Доставка"],
        [9.70, 4.28, "Персонал"], [7.91, 5.27, "Платежи"],
      ].map(([x, y, label], i) => [
        box(x, y, 1.55, 0.62, i % 2 ? C.white : C.pink, { line: C.line, radius: true }),
        text(label, x, y + 0.18, 1.55, 0.2, 13, C.text, { bold: true, align: "center" }),
        line(8.58, 3.18, x + 0.78, y + (y < 3 ? 0.62 : 0), C.accent, 1.2),
      ]).flat(),
      box(7.12, 6.04, 4.95, 0.52, C.accent, { line: C.accent, radius: true }),
      text("Lotus связывает операции и их состояние", 7.25, 6.18, 4.68, 0.2, 14, C.white, { bold: true, align: "center" }),
    ],
  },
  {
    bg: C.bg,
    notes: "После оформления заказ проходит через последовательную цепочку. Сервер проверяет данные, актуальные цены и доступность цветов. Затем система резервирует необходимый состав. Сотрудник меняет статус заказа только через разрешённые переходы. Для доставки создаётся отдельная запись, а важные действия сохраняются в журнале.",
    items: [
      ...header(3, "Единый процесс", "Путь заказа в системе Lotus"),
      text("Каждый этап изменяет связанные данные автоматически. Сервер проверяет допустимость переходов и сохраняет историю операций.", 0.72, 1.77, 11.6, 0.42, 17, C.muted),
      // A wide editable process line.
      line(1.0, 3.56, 12.0, 3.56, C.pink, 3),
      ...[
        [0.76, "Покупатель", "01", C.white], [2.28, "Оформление\nзаказа", "02", C.white],
        [3.80, "Проверка\nстоимости и наличия", "03", C.warm], [5.42, "Резервирование\nцветов", "04", C.pink],
        [7.12, "Работа\nфлориста", "05", C.white], [8.70, "Самовывоз\nили доставка", "06", C.pink],
        [10.46, "Завершение\nзаказа", "07", C.white], [11.99, "История\nи аудит", "08", C.warm],
      ].map(([x, label, num, fill]) => [
        circle(Number(x), 2.84, 0.78, fill, { line: C.accent }),
        text(num, Number(x), 3.06, 0.78, 0.18, 12, C.rose, { bold: true, align: "center" }),
        text(label, Number(x) - 0.42, 4.00, 1.62, 0.72, 11.5, C.text, { bold: true, align: "center" }),
      ]).flat(),
      box(0.88, 5.36, 3.45, 0.66, C.pink, { line: C.pink, radius: true }),
      text("Резервирование защищает остатки", 1.05, 5.58, 3.1, 0.2, 14, C.text, { bold: true, align: "center" }),
      box(4.85, 5.36, 3.45, 0.66, C.warm, { line: C.pink, radius: true }),
      text("Доставка создаётся отдельно", 5.02, 5.58, 3.1, 0.2, 14, C.text, { bold: true, align: "center" }),
      box(8.82, 5.36, 3.45, 0.66, C.accent, { line: C.accent, radius: true }),
      text("Аудит сохраняет изменения", 8.99, 5.58, 3.1, 0.2, 14, C.white, { bold: true, align: "center" }),
    ],
  },
  {
    bg: C.bg,
    notes: "Заказ нельзя произвольно перевести в любой статус. Сервер проверяет текущий статус, тип получения и состояние оплаты. Для самовывоза отсутствует этап доставки. Если заказ уже оплачен, сначала нужно оформить возврат. Изменение статуса, резервирование и связанные операции выполняются транзакционно.",
    items: [
      ...header(4, "Заказы", "Управление жизненным циклом заказа"),
      text("Переходы проверяются на сервере и связаны с резервом, доставкой и оплатой.", 0.72, 1.78, 7.2, 0.34, 17, C.muted),
      // Main state machine.
      chevron(0.82, 3.02, 1.35, 0.66, C.pink, "Новый", 13),
      chevron(2.17, 3.02, 1.45, 0.66, C.pink, "Подтверждён", 11),
      chevron(3.62, 3.02, 1.42, 0.66, C.pink, "Собирается", 11),
      chevron(5.04, 3.02, 1.20, 0.66, C.pink, "Готов", 13),
      chevron(6.24, 3.02, 1.42, 0.66, C.warm, "Доставляется", 10.5),
      chevron(7.66, 3.02, 1.36, 0.66, C.accent, "Выполнен", 11),
      line(4.75, 3.86, 4.75, 4.55, C.accent, 1.4),
      box(4.05, 4.55, 1.40, 0.62, "#F3E2E0", { line: C.red, radius: true }),
      text("Отменён", 4.05, 4.76, 1.40, 0.18, 15, C.red, { bold: true, align: "center" }),
      box(9.72, 2.20, 2.55, 3.25, C.white, { line: C.line, radius: true }),
      text("Правила переходов", 9.92, 2.48, 2.12, 0.28, 17, C.text, { font: "Georgia" }),
      ...bulletBlock(["следующий статус", "самовывоз без доставки", "оплата: сначала возврат", "ошибка = полный откат"], 9.92, 3.06, 2.14, 12.5, 0.56, C.muted),
    ],
  },
  {
    bg: C.bg,
    notes: "Складской учёт не ограничивается одним числом. Lotus различает физическое количество и доступный остаток. После подтверждения заказа цветы резервируются, поэтому другой заказ не сможет использовать то же количество. При отмене резерв освобождается. После выполнения система фиксирует фактическое списание.",
    items: [
      ...header(5, "Склад", "Автоматизация складских остатков"),
      box(0.72, 1.88, 5.18, 1.42, C.warm, { line: C.pink, radius: true }),
      text("Доступный остаток", 1.04, 2.14, 1.88, 0.26, 17, C.rose, { bold: true }),
      text("=", 2.96, 2.10, 0.35, 0.35, 24, C.accent, { font: "Georgia", align: "center" }),
      text("Физический остаток", 3.36, 2.16, 1.42, 0.24, 14, C.text, { bold: true, align: "center" }),
      text("−", 4.82, 2.10, 0.35, 0.35, 24, C.accent, { font: "Georgia", align: "center" }),
      text("Активный резерв", 5.12, 2.16, 1.02, 0.24, 14, C.text, { bold: true, align: "center" }),
      text("Lotus отдельно учитывает остатки, резервы, минимум и складские движения.", 0.82, 3.66, 4.9, 0.52, 17, C.muted),
      box(6.55, 1.86, 5.65, 3.90, C.white, { line: C.line, radius: true }),
      text("Состояние цветка на складе", 6.90, 2.14, 4.8, 0.3, 18, C.text, { font: "Georgia" }),
      ...[
        ["Физический остаток", "42", C.text], ["Активный резерв", "15", C.rose], ["Доступно", "27", C.accent], ["Минимальный остаток", "10", C.orange],
      ].map(([label, value, color], i) => [
        text(label, 6.92, 2.80 + i * 0.56, 2.9, 0.2, 14, C.muted),
        text(value, 10.65, 2.75 + i * 0.56, 0.8, 0.25, 18, color, { bold: true, align: "right" }),
        line(6.92, 3.18 + i * 0.56, 11.42, 3.18 + i * 0.56, C.line, 0.8),
      ]).flat(),
      box(0.72, 5.38, 11.48, 0.90, C.white, { line: C.line, radius: true }),
      ...[
        ["Подтвердить", "создаётся резерв"], ["Отменить", "резерв освобождается"], ["Выполнить", "резерв → списание"],
      ].map(([a,b], i) => [
        box(0.96 + i*3.72, 5.52, 1.60, 0.46, i===2?C.warm:C.pink, { line: C.line, radius: true }),
        text(a, 1.04 + i*3.72, 5.64, 1.44, 0.20, 12.5, C.text, { bold: true, align: "center" }),
        text(b, 2.70 + i*3.72, 5.66, 1.55, 0.18, 12.5, i===2?C.accent:C.muted),
        ...(i<2 ? [line(4.30 + i*3.72, 5.75, 4.68 + i*3.72, 5.75, C.accent, 1.5)] : []),
      ]).flat(),
    ],
  },
  {
    bg: C.bg,
    notes: "Менеджер склада создаёт документ поступления и добавляет позиции поставщика. Пока документ находится в черновике, остатки не меняются. При проведении система увеличивает количество цветов, создаёт складские движения и пересчитывает закупочную цену. Повторно провести тот же документ нельзя.",
    items: [
      ...header(6, "Закупки", "Автоматизация закупок"),
      text("Проведение документа — точка, в которой закупка становится складским движением.", 0.72, 1.80, 9.3, 0.34, 17, C.muted),
      ...[
        [0.82, "Поставщик", C.white], [3.08, "Черновик\nпоступления", C.white], [5.34, "Проверка\nсостава и цен", C.warm], [7.60, "Проведение\nдокумента", C.pink], [9.86, "Остаток +\nцена", C.accent],
      ].map(([x, label, fill], i) => [
        box(Number(x), 2.82, 1.72, 1.05, fill, { line: i===4?C.accent:C.line, radius: true }),
        text(label, Number(x)+0.12, 3.04, 1.48, 0.58, 12.5, i===4?C.white:C.text, { bold: true, align: "center" }),
        ...(i<4 ? [line(Number(x)+1.72, 3.35, Number(x)+2.08, 3.35, C.accent, 2)] : []),
      ]).flat(),
      box(0.82, 4.46, 5.15, 1.48, C.white, { line: C.line, radius: true }),
      text("После проведения", 1.10, 4.84, 1.85, 0.30, 17, C.text, { font: "Georgia" }),
      ...bulletBlock(["остатки увеличиваются", "движения создаются", "связь с документом", "повторная проводка запрещена"], 3.18, 4.66, 2.48, 12, 0.30, C.muted),
      box(6.55, 4.46, 5.65, 1.48, C.warm, { line: C.pink, radius: true }),
      text("Закупочная цена", 6.88, 4.84, 1.65, 0.30, 17, C.rose, { bold: true }),
      text("пересчитывается как средневзвешенная\nпо принятому количеству и стоимости", 8.55, 4.72, 3.20, 0.68, 14, C.text),
    ],
  },
  {
    bg: C.bg,
    notes: "Стоимость заказа рассчитывает сервер. Для авторского букета сервер повторно получает актуальные цены цветов и упаковки. При изменении стоимости доставки пересчитывается итог заказа и ожидающий платёж. Для проверки базы создан отдельный read-only скрипт финансовой целостности.",
    items: [
      ...header(7, "Финансы", "Контроль оплаты и итоговой суммы"),
      text("Формула заказа", 0.78, 1.92, 2.2, 0.28, 19, C.rose, { font: "Georgia" }),
      ...[
        ["Стоимость товаров", C.white], ["Стоимость упаковки", C.white], ["Стоимость доставки", C.warm], ["Итог заказа", C.accent], ["Платёж", C.pink],
      ].map(([label, fill], i) => [
        box(0.82, 2.42 + i*0.56, 4.22, 0.42, fill, { line: i===3?C.accent:C.line, radius: true }),
        text(label, 1.06, 2.54 + i*0.56, 2.0, 0.18, 14, i===3?C.white:C.text, { bold: i===3 }),
        ...(i===2 ? [text("+", 4.36, 2.54 + i*0.56, 0.32, 0.18, 17, C.rose, { bold: true, align: "center" })] : []),
      ]).flat(),
      box(0.82, 5.45, 4.22, 0.60, C.text, { line: C.text, radius: true }),
      text("Несогласованное изменение → полный откат", 1.05, 5.66, 3.75, 0.18, 14, C.white, { bold: true, align: "center" }),
      box(6.00, 1.92, 6.18, 4.20, C.white, { line: C.line, radius: true }),
      text("Состояния платежа", 6.36, 2.22, 2.6, 0.28, 19, C.text, { font: "Georgia" }),
      ...[
        ["Ожидает оплаты", C.warm], ["Оплачено", C.pink], ["Возвращено", "#F3E2E0"],
      ].map(([label, fill], i) => [
        box(6.38, 2.82 + i*0.67, 2.35, 0.44, fill, { line: C.line, radius: true }),
        text(label, 6.58, 2.95 + i*0.67, 1.95, 0.18, 14, C.text, { bold: true, align: "center" }),
      ]).flat(),
      line(8.92, 3.05, 9.60, 3.05, C.accent, 1.6), line(8.92, 3.72, 9.60, 3.72, C.accent, 1.6), line(8.92, 4.39, 9.60, 4.39, C.accent, 1.6),
      box(9.64, 2.84, 2.12, 1.98, C.warm, { line: C.pink, radius: true }),
      text("Синхронизация", 9.78, 3.12, 1.84, 0.22, 13.5, C.rose, { bold: true, align: "center" }),
      text("pending payment.amount\n= total заказа", 9.78, 3.62, 1.84, 0.44, 12.5, C.text, { align: "center" }),
      text("cash", 6.42, 5.35, 1.22, 0.36, 16, C.accent, { bold: true, align: "center" }),
      text("transfer", 7.90, 5.35, 1.22, 0.36, 16, C.accent, { bold: true, align: "center" }),
      text("оба способа продолжают работать", 9.38, 5.38, 2.2, 0.3, 13, C.muted, { italic: true, align: "center" }),
    ],
  },
  {
    bg: C.bg,
    notes: "Самовывоз и доставка имеют разные процессы. Для доставки менеджер назначает сотрудника с ролью курьера. Курьер получает ограниченную страницу и видит только собственные назначения. Он может последовательно отметить начало пути и завершение доставки. Сервер повторно проверяет принадлежность каждой доставки.",
    items: [
      ...header(8, "Доставка", "Управление доставкой и курьерами"),
      text("Разные способы получения → разные разрешённые переходы.", 0.72, 1.80, 8.5, 0.34, 17, C.muted),
      box(0.78, 2.42, 5.45, 3.22, C.white, { line: C.line, radius: true }),
      text("Самовывоз", 1.10, 2.72, 2.0, 0.28, 19, C.rose, { font: "Georgia" }),
      chevron(1.14, 3.44, 1.55, 0.58, C.pink, "Готов", 16),
      chevron(3.30, 3.44, 1.72, 0.58, C.accent, "Выполнен", 15),
      line(2.69, 3.73, 3.24, 3.73, C.accent, 1.8),
      text("Стоимость доставки = 0", 1.20, 4.48, 3.90, 0.24, 16, C.text, { bold: true, align: "center" }),
      text("этап «Доставляется» отсутствует", 1.20, 4.94, 3.90, 0.22, 14, C.muted, { align: "center" }),
      box(6.52, 2.42, 5.66, 3.22, C.warm, { line: C.pink, radius: true }),
      text("Доставка", 6.86, 2.72, 2.0, 0.28, 19, C.rose, { font: "Georgia" }),
      ...[
        [6.88, "Ожидает\nназначения"], [8.38, "Назначена"], [9.86, "В пути"], [11.22, "Доставлена"],
      ].map(([x, label], i) => [
        box(Number(x), 3.44, 1.16, 0.58, i===3?C.accent:C.white, { line: C.pink, radius: true }),
        text(label, Number(x)+0.04, 3.58, 1.08, 0.36, 10.5, i===3?C.white:C.text, { bold: true, align: "center" }),
        ...(i<3 ? [line(Number(x)+1.16, 3.73, Number(x)+1.36, 3.73, C.accent, 1.5)] : []),
      ]).flat(),
      text("Курьер видит только свои назначения", 6.92, 4.52, 4.72, 0.24, 16, C.text, { bold: true, align: "center" }),
      text("сервер проверяет роль, владельца доставки\nи допустимость перехода", 6.92, 4.96, 4.72, 0.40, 14, C.muted, { align: "center" }),
    ],
  },
  {
    bg: C.bg,
    notes: "В системе отсутствует общий пароль для всех сотрудников. Каждый сотрудник входит по личному телефону и паролю. Права определяются назначенными ролями. Проверки выполняются не только в интерфейсе, но и на сервере. Изменение роли, сброс пароля или отключение сотрудника отзывает его активные сессии.",
    items: [
      ...header(9, "Персонал", "Разделение доступа сотрудников"),
      text("Права проверяются на странице, в server action и в API.", 0.72, 1.80, 8.4, 0.34, 17, C.muted),
      // Editable table.
      box(0.72, 2.38, 7.38, 3.52, C.white, { line: C.line, radius: true }),
      box(0.72, 2.38, 7.38, 0.56, C.text, { line: C.text, radius: true }),
      text("Роль", 1.00, 2.57, 1.55, 0.20, 14, C.white, { bold: true }),
      text("Основные возможности", 2.68, 2.57, 4.82, 0.20, 14, C.white, { bold: true }),
      ...[
        ["Супер-администратор", "полный доступ, сотрудники, аудит"],
        ["Флорист", "заказы, оплаты, букеты, доступные остатки"],
        ["Менеджер склада", "склад, цены, поставщики, поступления, 3D"],
        ["Курьер", "только назначенные доставки"],
      ].map(([role, rights], i) => [
        line(0.98, 2.94 + i*0.70, 7.82, 2.94 + i*0.70, C.line, 0.8),
        text(role, 1.00, 3.10 + i*0.70, 1.55, 0.30, 13, i===0?C.rose:C.text, { bold: true }),
        text(rights, 2.68, 3.10 + i*0.70, 4.90, 0.30, 13, C.muted),
      ]).flat(),
      box(8.54, 2.38, 3.66, 3.52, C.warm, { line: C.pink, radius: true }),
      text("Защитные механизмы", 8.84, 2.70, 3.0, 0.30, 18, C.rose, { font: "Georgia" }),
      ...bulletBlock(["личные пароли и scrypt", "серверные сессии с TTL", "отзыв старых сессий", "ограничение попыток входа", "защита последнего super_admin"], 8.88, 3.30, 2.98, 14, 0.42, C.text),
    ],
  },
  {
    bg: C.bg,
    notes: "Конструктор связан со складом, поэтому покупатель работает не с отдельным демонстрационным списком, а с активными цветами магазина. После добавления букета в корзину сервер повторно проверяет позиции и цены. В заказ сохраняется снимок состава, благодаря чему история остаётся корректной даже после изменения каталога.",
    items: [
      ...header(10, "Конструктор", "Связь конструктора со складом и заказами"),
      image("constructor.png", 0.72, 1.86, 5.42, 3.55),
      box(0.72, 5.58, 5.42, 0.50, C.warm, { line: C.pink, radius: true }),
      text("Реальный экран конструктора: 3D-сцена загружается из проекта.", 0.90, 5.74, 5.04, 0.16, 11, C.muted, { align: "center" }),
      // Data flow.
      ...[
        [6.72, "Цветы\nсклада", C.white], [8.14, "3D-\nконструктор", C.pink], [9.56, "Корзина", C.white], [10.98, "Серверная\nпроверка", C.warm], [12.34, "Снимок\nзаказа", C.accent],
      ].map(([x, label, fill], i) => [
        box(Number(x), 2.46, 1.20, 1.08, fill, { line: i===4?C.accent:C.line, radius: true }),
        text(label, Number(x)+0.05, 2.78, 1.10, 0.42, 13, i===4?C.white:C.text, { bold: true, align: "center" }),
        ...(i<4 ? [line(Number(x)+1.20, 3.00, Number(x)+1.34, 3.00, C.accent, 1.6)] : []),
      ]).flat(),
      box(6.74, 4.22, 6.80, 1.30, C.white, { line: C.line, radius: true }),
      text("Сервер использует реальные данные", 7.02, 4.48, 2.72, 0.24, 17, C.text, { font: "Georgia" }),
      ...bulletBlock(["цветы и доступное количество", "цены и актуальные упаковки", "состав и цена сохраняются в снимке"], 9.82, 4.38, 3.25, 12.5, 0.36, C.muted),
    ],
  },
  {
    bg: C.bg,
    notes: "Lotus построен на Next.js и PostgreSQL. Бизнес-правила находятся на сервере, а критические изменения выполняются внутри транзакций. Проверки прав централизованы. Файлы изображений и 3D-моделей хранятся отдельно от исходного кода и должны резервироваться вместе с базой данных.",
    items: [
      ...header(11, "Техническая основа", "Архитектура системы"),
      // Architecture layers.
      box(0.82, 1.90, 11.35, 0.58, C.pink, { line: C.pink, radius: true }),
      text("Публичный интерфейс и админка", 1.12, 2.09, 10.70, 0.20, 16, C.text, { bold: true, align: "center" }),
      line(6.50, 2.48, 6.50, 2.72, C.accent, 1.8),
      box(1.48, 2.72, 10.02, 0.58, C.white, { line: C.line, radius: true }),
      text("Next.js App Router", 1.76, 2.91, 9.46, 0.20, 16, C.text, { bold: true, align: "center" }),
      line(6.50, 3.30, 6.50, 3.54, C.accent, 1.8),
      box(2.14, 3.54, 8.70, 0.58, C.warm, { line: C.pink, radius: true }),
      text("Server Actions и API  ·  централизованные permissions", 2.38, 3.73, 8.22, 0.20, 15, C.rose, { bold: true, align: "center" }),
      line(6.50, 4.12, 6.50, 4.36, C.accent, 1.8),
      box(2.80, 4.36, 7.38, 0.58, C.white, { line: C.line, radius: true }),
      text("Транзакции PostgreSQL", 3.04, 4.55, 6.90, 0.20, 16, C.text, { bold: true, align: "center" }),
      line(6.50, 4.94, 6.50, 5.18, C.accent, 1.8),
      box(0.82, 5.18, 4.22, 0.66, C.text, { line: C.text, radius: true }),
      text("База данных\nadmin_audit_log", 1.03, 5.34, 3.80, 0.34, 14, C.white, { bold: true, align: "center" }),
      box(5.40, 5.18, 3.10, 0.66, C.pink, { line: C.pink, radius: true }),
      text("var/flower-models", 5.58, 5.42, 2.74, 0.20, 13, C.text, { bold: true, align: "center" }),
      box(8.86, 5.18, 3.31, 0.66, C.warm, { line: C.pink, radius: true }),
      text("var/product-images", 9.05, 5.42, 2.92, 0.20, 13, C.rose, { bold: true, align: "center" }),
      text("Проверки качества: 63 теста  ·  ESLint  ·  TypeScript  ·  production build", 1.00, 6.38, 11.0, 0.22, 14, C.muted, { align: "center" }),
    ],
  },
  {
    bg: C.bg,
    notes: "В результате практики получилась не только витрина цветочного магазина, но и система управления его основными процессами. Lotus связывает заказ, склад, оплату, доставку и действия сотрудников. Следующим этапом станет подготовка проекта к стабильному развёртыванию и работе с растущим количеством данных.",
    items: [
      ...header(12, "Итог практики", "Результат и дальнейшее развитие"),
      box(0.72, 1.86, 5.55, 3.98, C.white, { line: C.line, radius: true }),
      text("Реализовано", 1.05, 2.18, 2.4, 0.32, 22, C.rose, { font: "Georgia" }),
      ...bulletBlock(["единое управление заказами", "автоматическое резервирование и списание", "учёт поставщиков и поступлений", "контроль оплаты и доставки", "персональные роли и аудит", "интеграция склада с 3D-конструктором"], 1.05, 2.82, 4.72, 15, 0.44),
      box(6.64, 1.86, 5.56, 3.98, C.warm, { line: C.pink, radius: true }),
      text("Следующие этапы", 6.96, 2.18, 2.7, 0.32, 22, C.rose, { font: "Georgia" }),
      ...bulletBlock(["пагинация больших списков", "автоматические проверки через CI", "объектное хранилище для файлов", "регулярное резервное копирование", "подготовка production-развёртывания"], 6.98, 2.82, 4.72, 15, 0.50, C.text),
      box(1.40, 6.14, 10.48, 0.62, C.accent, { line: C.accent, radius: true }),
      text("Lotus объединяет клиентскую часть и внутренние операции в одной проверяемой системе.", 1.72, 6.35, 9.84, 0.20, 15, C.white, { bold: true, align: "center" }),
      image("lotus-hero-bouquet.png", 11.32, 5.72, 1.05, 0.96),
      text("Спасибо за внимание", 0.72, 6.98, 3.2, 0.18, 11, C.muted, { italic: true }),
    ],
  },
];

if (slides.length !== 12) throw new Error(`Expected 12 slides, got ${slides.length}`);

await fs.mkdir(assetDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
const logoSvg = await fs.readFile(path.join(root, "src", "app", "icon.svg"));
await sharp(logoSvg).resize(256, 256).png().toFile(path.join(assetDir, "logo.png"));

const normalizedSlides = slides.map((slide, index) => ({
  ...slide,
  index: index + 1,
  items: slide.items.map((item) => {
    if (item.type === "image") {
      const resolved = item.file === "logo.png"
        ? path.join(assetDir, "logo.png")
        : item.file === "lotus-hero-bouquet.png"
          ? path.join(root, "public", "images", "lotus-hero-bouquet.png")
          : path.join(assetDir, item.file);
      return { ...item, file: resolved };
    }
    return item;
  }),
}));
await fs.writeFile(manifestPath, `\ufeff${JSON.stringify(normalizedSlides)}`, "utf8");

const ps = String.raw`
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath '${manifestPath.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json
$pptx = '${pptxPath.replace(/'/g, "''")}'
$pdf = '${pdfPath.replace(/'/g, "''")}'
$preview = '${previewDir.replace(/'/g, "''")}'
$ppLayoutBlank = 12
$ppSaveAsOpenXMLPresentation = 24
$ppSaveAsPDF = 32
$msoShapeRectangle = 1
$msoShapeRoundedRectangle = 5
$msoShapeOval = 9
$msoShapeChevron = 52
$msoFalse = 0
$msoTrue = -1
$msoAnchorTop = 1
$msoAnchorMiddle = 3
$ppAlignLeft = 1
$ppAlignCenter = 2
$ppAlignRight = 3

function Rgb([string]$hex) {
  $h = ([string]$hex).Trim().TrimStart('#')
  if ($h.Length -lt 6) { Write-Host ("BAD_COLOR:" + [string]$hex); return 0 }
  return [Convert]::ToInt32($h.Substring(4,2),16) * 65536 + [Convert]::ToInt32($h.Substring(2,2),16) * 256 + [Convert]::ToInt32($h.Substring(0,2),16)
}
function Pt($n) { return [double]$n * 72 }
function SetText($shape, $value, $size, $color, $font, $bold, $italic, $align, $valign, $margin) {
  $tf = $shape.TextFrame2
  $tf.TextRange.Text = [string]$value
  $tf.MarginLeft = Pt($margin); $tf.MarginRight = Pt($margin); $tf.MarginTop = Pt($margin); $tf.MarginBottom = Pt($margin)
  $tf.WordWrap = $msoTrue
  $tf.VerticalAnchor = if ($valign -eq 'middle') { $msoAnchorMiddle } else { $msoAnchorTop }
  $tf.TextRange.Font.Name = $font
  $tf.TextRange.Font.Size = [double]$size
  $tf.TextRange.Font.Bold = if ($bold) { $msoTrue } else { $msoFalse }
  $tf.TextRange.Font.Italic = if ($italic) { $msoTrue } else { $msoFalse }
  $tf.TextRange.Font.Fill.ForeColor.RGB = Rgb($color)
  $tf.TextRange.ParagraphFormat.Alignment = switch ($align) { 'center' { $ppAlignCenter } 'right' { $ppAlignRight } default { $ppAlignLeft } }
}
function AddText($slide, $item) {
  $sh = $slide.Shapes.AddTextbox(1, (Pt $item.x), (Pt $item.y), (Pt $item.w), (Pt $item.h))
  SetText $sh $item.value $item.size $item.color $item.font ([bool]$item.bold) ([bool]$item.italic) $item.align $item.valign $item.margin
  return $sh
}
function AddBox($slide, $item, $type) {
  $sh = $slide.Shapes.AddShape($type, (Pt $item.x), (Pt $item.y), (Pt $item.w), (Pt $item.h))
  $sh.Fill.ForeColor.RGB = Rgb($item.fill)
  $sh.Fill.Transparency = ([double]$item.transparency / 100)
  $sh.Line.ForeColor.RGB = Rgb($item.line)
  $sh.Line.Weight = 0.8
  return $sh
}
function AddLine($slide, $item) {
  $sh = $slide.Shapes.AddLine((Pt $item.x1), (Pt $item.y1), (Pt $item.x2), (Pt $item.y2))
  $sh.Line.ForeColor.RGB = Rgb($item.color)
  $sh.Line.Weight = [double]$item.width
  if ([double]$item.dash -gt 0) { $sh.Line.DashStyle = 2 }
  return $sh
}
function AddPicture($slide, $item) {
  return $slide.Shapes.AddPicture([string]$item.file, $msoFalse, $msoTrue, (Pt $item.x), (Pt $item.y), (Pt $item.w), (Pt $item.h))
}

$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = $msoTrue
$pres = $ppt.Presentations.Add($msoFalse)
$pres.PageSetup.SlideWidth = Pt(13.333)
$pres.PageSetup.SlideHeight = Pt(7.5)
try {
  $pres.BuiltInDocumentProperties.Item('Title').Value = 'Автоматизация цветочного магазина Lotus'
  $pres.BuiltInDocumentProperties.Item('Author').Value = 'Шарифов Тигран'
  $pres.BuiltInDocumentProperties.Item('Subject').Value = 'Производственная практика, 2026'
} catch {}

foreach ($data in $manifest) {
  $slide = $pres.Slides.Add($data.index, $ppLayoutBlank)
  $slide.Background.Fill.ForeColor.RGB = Rgb($data.bg)
  foreach ($item in $data.items) {
    switch ([string]$item.type) {
      'text' { [void](AddText $slide $item) }
      'box' { $shapeType = $msoShapeRectangle; if ([bool]$item.radius) { $shapeType = $msoShapeRoundedRectangle }; [void](AddBox $slide $item $shapeType) }
      'circle' { [void](AddBox $slide $item $msoShapeOval) }
      'chevron' {
        [void](AddBox $slide $item $msoShapeChevron)
        $chevColor = if ([string]$item.fill -eq '#C97D72') { '#FFFFFF' } else { '#342622' }
        $tx = [pscustomobject]@{ value = [string]$item.value; x = [double]$item.x + 0.10; y = [double]$item.y + 0.13; w = [double]$item.w - 0.20; h = 0.46; size = [double]$item.size; color = $chevColor; font = 'Arial'; bold = $true; italic = $false; align = 'center'; valign = 'top'; margin = 0.01 }
        [void](AddText $slide $tx)
      }
      'line' { [void](AddLine $slide $item) }
      'image' { [void](AddPicture $slide $item) }
    }
  }
  try {
    foreach ($noteShape in $slide.NotesPage.Shapes) {
      if ($noteShape.HasTextFrame -and $noteShape.PlaceholderFormat.Type -eq 2) {
        $noteShape.TextFrame.TextRange.Text = [string]$data.notes
        break
      }
    }
  } catch {}
}

if (Test-Path -LiteralPath $pptx) { Remove-Item -LiteralPath $pptx -Force }
if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf -Force }
$pres.SaveAs($pptx, $ppSaveAsOpenXMLPresentation)
$pres.SaveAs($pdf, $ppSaveAsPDF)
if (Test-Path -LiteralPath $preview) { Get-ChildItem -LiteralPath $preview -File | Remove-Item -Force }
$pres.Export($preview, 'PNG', 1600, 900)
$pres.Close()
$ppt.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
`;

const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
  cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024,
});
if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  throw new Error(`PowerPoint export failed with status ${result.status}`);
}

const exportedFiles = (await fs.readdir(previewDir)).filter((name) => /\.png$/i.test(name));
for (const name of exportedFiles) {
  const match = name.match(/(\d+)/);
  if (!match) continue;
  const target = `slide-${String(Number(match[1])).padStart(2, "0")}.png`;
  if (name !== target) await fs.rename(path.join(previewDir, name), path.join(previewDir, target));
}
const previewFiles = (await fs.readdir(previewDir))
  .filter((name) => /^slide-\d{2}\.png$/i.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (previewFiles.length !== 12) throw new Error(`Expected 12 previews, got ${previewFiles.length}`);
const thumbW = 400;
const thumbH = 225;
const montageW = thumbW * 4;
const montageH = thumbH * 3;
const composites = [];
for (let i = 0; i < previewFiles.length; i += 1) {
  const input = path.join(previewDir, previewFiles[i]);
  const buffer = await sharp(input).resize(thumbW, thumbH, { fit: "fill" }).png().toBuffer();
  composites.push({ input: buffer, left: (i % 4) * thumbW, top: Math.floor(i / 4) * thumbH });
}
await sharp({ create: { width: montageW, height: montageH, channels: 4, background: C.bg } })
  .composite(composites).png().toFile(path.join(outDir, "lotus-automation-practice-montage.png"));

console.log(JSON.stringify({ pptxPath, pdfPath, previewDir, previewFiles, slides: slides.length }, null, 2));
