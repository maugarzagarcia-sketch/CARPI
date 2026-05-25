const NOTION_VERSION = "2022-06-28";
const BASE = "https://api.notion.com/v1";

const DB = {
  pedidos:  "fadf3164ca454ceb9869714707f11e26",
  clientes: "cca125add8b448da8fbf564996da6361",
  maestros: "db1e1045f7254a1fbe486acd7810a80e",
  nomina:   "a7fd1c71c7e4480db4d8917da3b70ab1",
  gastos:   "525dbb73e7514cce93f0f3151dcf0a21",
};

function notionHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function propText(prop) {
  if (!prop) return "";
  if (prop.type === "title")     return prop.title?.map(t => t.plain_text).join("") || "";
  if (prop.type === "rich_text") return prop.rich_text?.map(t => t.plain_text).join("") || "";
  if (prop.type === "number")    return prop.number ?? null;
  if (prop.type === "select")    return prop.select?.name || "";
  if (prop.type === "date")      return prop.date?.start || "";
  if (prop.type === "phone_number") return prop.phone_number || "";
  if (prop.type === "formula")   return prop.formula?.number ?? prop.formula?.string ?? null;
  return "";
}

function pageToObj(page, type) {
  const p = page.properties;
  const base = { _id: page.id };
  if (type === "pedidos") return { ...base, folio: propText(p["Pedido"]), cliente: propText(p["Cliente"]), desc: propText(p["Descripción"]), fecha: propText(p["Fecha de entrega"]), estado: estadoToCode(propText(p["Estado"])), precio: propText(p["Precio total"]) || 0, anticipo: propText(p["Anticipo"]) || 0, notas: propText(p["Notas"]), pagos: [] };
  if (type === "clientes") return { ...base, nombre: propText(p["Nombre"]), tel: propText(p["Teléfono"]), referencia: propText(p["Cómo llegó"]), notas: propText(p["Notas"]) };
  if (type === "maestros") return { ...base, nombre: propText(p["Nombre"]), puesto: propText(p["Puesto"]), sueldo: propText(p["Sueldo semanal"]) || 0 };
  if (type === "nomina") return { ...base, maestro: propText(p["Maestro"]), semana: propText(p["Semana"]), monto: propText(p["Monto pagado"]) || 0, nota: propText(p["Nota"]) };
  if (type === "gastos") return { ...base, concepto: propText(p["Concepto"]), categoria: propText(p["Categoría"]), fecha: propText(p["Fecha"]), monto: propText(p["Monto"]) || 0, nota: propText(p["Proveedor / Nota"]) };
  return base;
}

function estadoToCode(label) {
  const map = { "Por iniciar": "pending", "En proceso": "progress", "Listo": "done", "Entregado": "delivered" };
  return map[label] || "pending";
}

function estadoToLabel(code) {
  const map = { pending: "Por iniciar", progress: "En proceso", done: "Listo", delivered: "Entregado" };
  return map[code] || "Por iniciar";
}

function buildProps(type, obj) {
  if (type === "pedidos") return { "Pedido": { title: [{ text: { content: obj.folio || "" } }] }, "Cliente": { rich_text: [{ text: { content: obj.cliente || "" } }] }, "Descripción": { rich_text: [{ text: { content: obj.desc || "" } }] }, "Fecha de entrega": obj.fecha ? { date: { start: obj.fecha } } : { date: null }, "Estado": { select: { name: estadoToLabel(obj.estado) } }, "Precio total": { number: parseFloat(obj.precio) || 0 }, "Anticipo": { number: parseFloat(obj.anticipo) || 0 }, "Notas": { rich_text: [{ text: { content: obj.notas || "" } }] } };
  if (type === "clientes") return { "Nombre": { title: [{ text: { content: obj.nombre || "" } }] }, "Teléfono": { phone_number: obj.tel || "" }, "Cómo llegó": { rich_text: [{ text: { content: obj.referencia || "" } }] }, "Notas": { rich_text: [{ text: { content: obj.notas || "" } }] } };
  if (type === "maestros") return { "Nombre": { title: [{ text: { content: obj.nombre || "" } }] }, "Puesto": { rich_text: [{ text: { content: obj.puesto || "" } }] }, "Sueldo semanal": { number: parseFloat(obj.sueldo) || 0 } };
  if (type === "nomina") return { "Pago": { title: [{ text: { content: obj.maestro + " - " + obj.semana } }] }, "Maestro": { rich_text: [{ text: { content: obj.maestro || "" } }] }, "Semana": obj.semana ? { date: { start: obj.semana + "-1" } } : { date: null }, "Monto pagado": { number: parseFloat(obj.monto) || 0 }, "Nota": { rich_text: [{ text: { content: obj.nota || "" } }] } };
  if (type === "gastos") return { "Concepto": { title: [{ text: { content: obj.concepto || "" } }] }, "Categoría": { select: { name: obj.categoria || "Otro" } }, "Fecha": obj.fecha ? { date: { start: obj.fecha } } : { date: null }, "Monto": { number: parseFloat(obj.monto) || 0 }, "Proveedor / Nota": { rich_text: [{ text: { content: obj.nota || "" } }] } };
  return {};
}

async function queryAll(dbId, token) {
  let results = [], cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${BASE}/databases/${dbId}/query`, { method: "POST", headers: notionHeaders(token), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Notion query error");
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: "Token no configurado" });

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const segments = (req.query.slug || []);
    const type   = segments[0];
    const pageId = segments[1] || null;
    const dbId   = DB[type];

    if (!dbId) return res.status(404).json({ error: "Recurso no encontrado" });

    if (req.method === "GET" && !pageId) {
      const pages = await queryAll(dbId, token);
      return res.status(200).json(pages.map(p => pageToObj(p, type)));
    }
    if (req.method === "POST") {
      const obj = req.body || {};
      const r = await fetch(`${BASE}/pages`, { method: "POST", headers: notionHeaders(token), body: JSON.stringify({ parent: { database_id: dbId }, properties: buildProps(type, obj) }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      return res.status(200).json(pageToObj(data, type));
    }
    if (req.method === "PATCH" && pageId) {
      const obj = req.body || {};
      const r = await fetch(`${BASE}/pages/${pageId}`, { method: "PATCH", headers: notionHeaders(token), body: JSON.stringify({ properties: buildProps(type, obj) }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      return res.status(200).json(pageToObj(data, type));
    }
    if (req.method === "DELETE" && pageId) {
      const r = await fetch(`${BASE}/pages/${pageId}`, { method: "PATCH", headers: notionHeaders(token), body: JSON.stringify({ archived: true }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.message); }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
