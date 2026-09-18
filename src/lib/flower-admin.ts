export const MAX_BIGINT = "9223372036854775807";
export const MAX_MIN_STOCK = 1_000_000;

export type FlowerDetailsInput = {
  name: string;
  slug: string;
  categoryId: string | null;
  description: string | null;
  color: string | null;
  unit: string;
  imageUrl: string | null;
  minimumStock: number;
};

export type CategoryInput = {
  name: string;
  slug: string;
  sortOrder: number;
};

type ParseResult<T> = { value: T; error: "" } | { value: null; error: string };

const transliteration: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function isDatabaseId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value)
    && (value.length < MAX_BIGINT.length || value <= MAX_BIGINT);
}

export function normalizeSlug(value: string, maxLength: number) {
  const transliterated = Array.from(value.normalize("NFKC").toLowerCase(), (character) =>
    transliteration[character] ?? character).join("");
  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

function normalizedText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().replace(/[ \t]+/g, " ");
}

function unsafeControls(value: string) {
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}

function optionalText(value: FormDataEntryValue | null, maximum: number): ParseResult<string | null> {
  const text = normalizedText(value);
  if (!text) return { value: null, error: "" };
  if (text.length > maximum || unsafeControls(text)) return { value: null, error: "Проверьте длину и допустимые символы" };
  return { value: text, error: "" };
}

function parseMinimum(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= MAX_MIN_STOCK ? number : null;
}

export function parseFlowerDetails(formData: FormData, imageUrlOverride?: string | null): ParseResult<FlowerDetailsInput> {
  const name = normalizedText(formData.get("name"));
  if (!name || name.length > 140 || unsafeControls(name)) return { value: null, error: "Название должно содержать от 1 до 140 символов" };
  const rawSlug = normalizedText(formData.get("slug"));
  const slug = normalizeSlug(rawSlug, 160);
  if (!rawSlug || !slug) return { value: null, error: "Укажите slug латинскими буквами, цифрами или словами" };
  const category = normalizedText(formData.get("category_id"));
  if (category && !isDatabaseId(category)) return { value: null, error: "Выберите существующую категорию" };
  const description = optionalText(formData.get("description"), 5000);
  if (description.error) return { value: null, error: "Описание содержит недопустимые символы или длиннее 5000 символов" };
  const color = optionalText(formData.get("color"), 80);
  if (color.error) return { value: null, error: "Цвет должен быть не длиннее 80 символов" };
  const unit = normalizedText(formData.get("unit"));
  if (!unit || unit.length > 30 || unsafeControls(unit)) return { value: null, error: "Единица измерения должна содержать от 1 до 30 символов" };
  const image = imageUrlOverride === undefined ? optionalText(formData.get("image_url"), 2000) : { value: imageUrlOverride, error: "" };
  if (image.error) return { value: null, error: "URL фотографии слишком длинный или содержит недопустимые символы" };
  if (imageUrlOverride === undefined && image.value) {
    try {
      const parsed = new URL(image.value);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      return { value: null, error: "URL фотографии должен начинаться с http:// или https://" };
    }
  }
  const minimumStock = parseMinimum(formData.get("min_stock_quantity"));
  if (minimumStock === null) return { value: null, error: `Минимальный остаток должен быть целым числом от 0 до ${MAX_MIN_STOCK}` };
  return { value: { name, slug, categoryId: category || null, description: description.value,
    color: color.value, unit, imageUrl: image.value, minimumStock }, error: "" };
}

export function parseCategory(formData: FormData): ParseResult<CategoryInput> {
  const name = normalizedText(formData.get("name"));
  if (!name || name.length > 100 || unsafeControls(name)) return { value: null, error: "Название категории должно содержать от 1 до 100 символов" };
  const rawSlug = normalizedText(formData.get("slug"));
  const slug = normalizeSlug(rawSlug, 120);
  if (!rawSlug || !slug) return { value: null, error: "Укажите slug категории" };
  const rawOrder = String(formData.get("sort_order") ?? "").trim();
  if (!/^\d{1,7}$/.test(rawOrder)) return { value: null, error: "Порядок должен быть целым числом от 0 до 1000000" };
  const sortOrder = Number(rawOrder);
  if (!Number.isSafeInteger(sortOrder) || sortOrder > 1_000_000) return { value: null, error: "Порядок должен быть целым числом от 0 до 1000000" };
  return { value: { name, slug, sortOrder }, error: "" };
}
