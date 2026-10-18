/*
<MODULE_CONTRACT>
  <purpose>Emit the RFC-1324 fixture composition/ trees — the scripted compose step's authored content (pages/prose/navigation/site + system.md overlay).</purpose>

  <non-goals>
    <item>Do not emit platform-owned files (wrangler, generated artifacts, business-profile scaffolding) — the compose seam carries authored content only.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1324: cold-run defect: compose missed business-profile seam, legal.scaffold, and domain-templated canonicalUrl</item>
  <item>RFC-1324: declare legal pageIds in system.md overlay — scaffold emits files, composer owns the route registry (B-04)</item>
  <item>RFC-1324: satisfy family agent-readiness baseline + h1 contract — level:1 heading, faq-list+faq entries, services record, identity.legal for scaffold placeholders</item>
  <item>RFC-1324: pin Atlas in home planets[] — B-02 requires every used block component declared (faq-list -> Atlas)</item>
  <item>RFC-1324: project service-kind PBP products into organization.services (Service JSON-LD satisfiable on PBP-native sites); compose seam gains src-root files for the image-delivery escape hatch</item>
  <item>RFC-1324: cold-run defect: confirmed-domain fixtures need a verification.google block in the overlay (SEARCH-VERIFY-01 errors on non-provisional hosts)</item>
  <history>RFC-1324</history>
</CHANGE_SUMMARY>
*/
// Run: pnpm exec tsx gen-rfc1324-compositions.ts (from packages/werkstatt-engine)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root =
  "/home/syrokomskyi/projects/warpgogol/werkstatt/packages/werkstatt-engine/src/intake/fixtures";

interface PageSpec {
  pageId: string;
  semanticType: string;
  star: string;
  planet: string;
  /** route slug per segment */
  routes: Record<string, string>;
  /** page frontmatter fields per segment */
  title: Record<string, string>;
  description: Record<string, string>;
  /** markdown block props per segment (heading/lead) */
  heading?: Record<string, string>;
  lead?: Record<string, string>;
  /** prose ref for markdown pages */
  prose?: string;
  /** credits page uses type: credits instead of markdown */
  credits?: boolean;
  llmsExclude?: boolean;
}

interface FixtureSpec {
  name: string;
  app: string; // canonical systemId (staging rewrites to e2e-<name>)
  legalName: string;
  /** PBP business entity id (business/<id>) the intake seeds */
  businessId: string;
  /** composer-authored contact email */
  email: string;
  /** confirmed real domain in intake.json — when set, the overlay declares a
      search-verification block (SEARCH-VERIFY-01 errors without it on a
      non-provisional host); provisional fixtures leave it unset */
  domain?: string;
  /** composer-authored place entity */
  place: {
    street: string;
    streetNumber: string;
    postalCode: string;
    locality: string;
    countryCode: string;
  };
  tagline: Record<string, string>;
  defaultDescription: Record<string, string>;
  skipLinkLabel: Record<string, string>;
  nativeNames: Record<string, string>;
  segments: string[];
  /** legalJurisdiction regimes legal.scaffold emits — manifest-only page entries, files are scaffold-owned */
  legalPages?: string[];
  /** home faq-list block + faq/{seg}/ entries (FAQPage JSON-LD baseline) */
  faq?: {
    heading: Record<string, string>;
    items: Record<string, Array<{ q: string; a: string }>>;
  };
  /** business-profile/{seg}/products/ record — kind:service projects into Service JSON-LD */
  service?: { name: Record<string, string>; description: Record<string, string> };
  pages: PageSpec[];
  proseTexts: Record<string, Record<string, string>>; // proseId -> seg -> body
  navLabels: Record<string, Record<string, string>>; // pageId -> seg -> label
  labels: (seg: string) => string;
}

function emit(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

const fm = (body: string) => `---\n${body}---\n`;

function systemMdOverlay(spec: FixtureSpec): string {
  const pages = spec.pages
    .map((p) => {
      const routes = spec.segments.map((s) => `      ${s}: "${p.routes[s] ?? ""}"`).join("\n");
      const llms = p.llmsExclude ? "\n      llms: exclude" : "";
      // B-02: planets[] must pin every component the page's blocks use —
      // home's faq-list block resolves to the Atlas section.
      const usedPlanets = [p.planet, ...(p.pageId === "home" && spec.faq ? ["Atlas"] : [])];
      const planets = usedPlanets
        .map((planet) => `      - { cosmicPlanet: ${planet}, pin: "latest" }`)
        .join("\n");
      return `  - pageId: ${p.pageId}
    semanticType: ${p.semanticType}
    output:
      sitemap: { category: ${p.semanticType === "home" ? "content" : p.credits ? "legal" : "content"}, lastmod: "2026-10-17", includeLastmod: ${p.credits ? "false" : "true"} }${llms}
    routes:
${routes}
    cosmicStar: ${p.star}
    planets:
${planets}`;
    })
    .join("\n\n");
  // legal.scaffold sole-owns the page files; the composer declares their routes.
  // Slugs stay German in every locale — the binding-language convention.
  const legalPages = (spec.legalPages ?? [])
    .map((pageId) => {
      const routes = spec.segments.map((s) => `      ${s}: "${pageId}"`).join("\n");
      return `  - pageId: ${pageId}
    semanticType: legal
    output:
      sitemap: { category: legal, lastmod: "2026-10-17", includeLastmod: false }
      llms: exclude
    routes:
${routes}
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }`;
    })
    .join("\n\n");
  const allPages = legalPages ? `${pages}\n\n${legalPages}` : pages;
  const i18n = spec.segments
    .map((s) => `    ${s}: { name: "${spec.nativeNames[s] ?? s}" }`)
    .join("\n");
  const legal = `  legal:
    responsibleName: "${spec.legalName}"
    address: "${spec.place.street} ${spec.place.streetNumber}, ${spec.place.postalCode} ${spec.place.locality}, ${spec.place.countryCode}"
    email: "${spec.email}"`;
  // A confirmed-domain site is a real search property — the composer carries a
  // verification block (dp7 parity); the fixture token is a placeholder-shaped
  // value, honest for the e2e host and replaced by the real GSC token at go-live.
  const verification = spec.domain
    ? `\nverification:\n  google:\n    method: meta-tag\n    token: "google-site-verification=e2e_fixture_${spec.name.replaceAll("-", "_")}"\n`
    : "";
  return `---
identity:
  tagline: "${spec.tagline[spec.segments[0]!]}"
  ctaTarget: contacts
${legal}
${verification}

i18n:
  supported:
${i18n}

clientEditable:
  - pages
  - prose
  - business-profile
  - navigation
  - site

sharedContext:
  requiredPageIds:
    - home

pages:
${allPages}

growth:
  vendor:
    adapter: "null"
    options: {}
  funnels: []
  experiments: []

robots:
  crawlerBlocklist:
    - nikto
    - nmap
    - sqlmap
---
`;
}

function pageFile(spec: FixtureSpec, p: PageSpec, seg: string): string {
  if (p.credits) {
    return fm(`kind: page
pageId: ${p.pageId}
cosmicStar: ${p.star}
title: "${p.title[seg]}"
description: "${p.description[seg]}"
lang: ${seg}
blocks:
  - id: credits-content
    type: credits
    props:
      heading: "${p.heading![seg]}"
      lead: "${p.lead![seg]}"
`);
  }
  // `level: 1` renders the block heading as the page's single <h1>
  // (HTML-STRUCT-03); faq-list on home feeds the FAQPage JSON-LD the
  // family agent-readiness baseline requires.
  const faqBlock =
    p.pageId === "home" && spec.faq
      ? `
  - id: home-faq
    type: faq-list
    props:
      header:
        heading: "${spec.faq.heading[seg] ?? spec.faq.heading[spec.segments[0]!]}"
      background:
        kind: transparent`
      : "";
  return fm(`kind: page
pageId: ${p.pageId}
cosmicStar: ${p.star}
title: "${p.title[seg]}"
description: "${p.description[seg]}"
lang: ${seg}
blocks:
  - id: ${p.pageId}-content
    type: markdown
    props:
      hideSectionNumber: true
      heading: "${p.heading![seg]}"
      level: 1
      contentRef: "prose/${p.prose}"${faqBlock}
`);
}

function navFile(spec: FixtureSpec, seg: string): string {
  const targets = spec.pages
    .map((p) => {
      const group = p.credits ? "legal" : "navigation";
      return `  - id: ${p.pageId}
    label: "${spec.navLabels[p.pageId]![seg]}"
    semanticTarget:
      kind: internal
      pageId: ${p.pageId}
    routeSlug: "${p.routes[seg] ?? ""}"
    group: ${group}`;
    })
    .join("\n");
  return fm(`targets:
${targets}
`);
}

function layoutFile(spec: FixtureSpec, seg: string): string {
  return fm(`defaultDescription: "${spec.defaultDescription[seg]}"
skipLinkLabel: "${spec.skipLinkLabel[seg]}"
`);
}

// RFC-0830 escape hatch — the credits gallery renders only below-the-fold
// thumbnails, so no image is the LCP element. The composer owns
// src/image-delivery.config.yaml (seeded empty at registration); this mirrors
// the override real sites carry for the same routes.
function imageDeliveryConfig(spec: FixtureSpec): string {
  const slugs = spec.segments
    .map((s) => spec.pages.find((p) => p.credits)?.routes[s])
    .filter((s): s is string => Boolean(s));
  const pattern = slugs.length === 1 ? slugs[0] : `{${slugs.join(",")}}`;
  return `# RFC-0830 IMG-DELIVERY escape-hatch overrides.
# Each entry needs: srcPattern, rules[], reason.
overrides:
  - srcPattern: "**"
    pagePattern: "**/${pattern}/**"
    rules:
      - IMG-DELIVERY-04
    reason: "Material credits list page — text/list layout without a hero; every image is a below-the-fold thumbnail, the LCP element is textual."
`;
}

// pbp.profile.validate requires web/, contact/, places/ under the default
// locale — composed from the resolved host and the published legal address
// (wg-onboard qa-log). canonicalUrl is templated: the stage substitutes the
// domain the register step actually resolved.
function businessProfileFiles(spec: FixtureSpec): Record<string, string> {
  const seg = spec.segments[0]!;
  const pl = spec.place;
  return {
    [`business-profile/${seg}/web/primary.md`]: fm(`schema: pbp/web-presence@1
id: web-presence/primary
type: web-presence
status: published
name: ${spec.legalName} website
kind: primary-website
canonicalUrl: "{{SITE_ORIGIN}}/"
businessRef:
  ref: pbp/business@1:business/${spec.businessId}
  expectedType: business
control: business-controlled
locales:
  ${seg}: ${seg}
`),
    [`business-profile/${seg}/contact/email.md`]: fm(`schema: pbp/contact-point@1
id: contact-point/email
type: contact-point
status: published
name: Corporate email
channel: email
governance:
  authorityRef: pbp/evidence-source@1:evidence-source/src-01
preferred: true
value: ${spec.email}
`),
    [`business-profile/${seg}/places/main.md`]: fm(`schema: pbp/place@1
id: place/main
type: place
status: published
name: ${pl.locality}
kind: locality
address:
  street: ${pl.street}
  streetNumber: "${pl.streetNumber}"
  postalCode: "${pl.postalCode}"
  locality: ${pl.locality}
  countryCode: ${pl.countryCode}
governance:
  authorityRef: pbp/evidence-source@1:evidence-source/src-01
`),
  };
}

// ── per-fixture specs ────────────────────────────────────────────────────

const RU_LABELS = `brandLabel: "E2E Валид"
brandAriaLabel: "E2E Valid GmbH — главная страница"

header:
  ctaLabel: "Контакты"
  motto: "Проверяемое качество по честной цене"
  navIds:
    - about
    - contacts

footer:
  statusLinkTitleSuffix: "Состояние системы"
  statusLinkAriaLabelSuffix: "Состояние системы"
  statusIconAriaLabel: "Состояние системы"
  taglineLines:
    - "Торговая компания из Германии."
    - "Информационный сайт о компании."
  motto: "информация · без продаж через сайт"
  navIds:
    - home
    - about
    - contacts
  legalIds:
    - credits
  contactIds:
    - email
  navGroups:
    navigationTitle: "НАВИГАЦИЯ"
    legalTitle: "ПРАВОВАЯ ИНФОРМАЦИЯ"
    contactTitle: "КОНТАКТЫ"

copyright:
  symbol: "©"
  yearFirst: 2026
  holder: "E2E Valid GmbH"

langSwitcher:
  switchAriaLabel: "{currentLang} — переключить язык на {lang}"

breadcrumbs:
  homeLabel: "Главная"
  navAriaLabel: "Навигационная цепочка"

sections:
  heroDecisionCard:
    decisionCardAriaLabel: "Основные сведения"
  priceCard:
    monthly: "В месяц"
    yearly: "В год"
    setup: "Подключение"
    includesHeading: "Включено"

orchestrator:
  counters: false
  inlineNumbers: false
  reveal: false
  parallax: false
  stagger: false
  smoothScroll: true
attribution:
  credits: byIntent
  proseAuthorship: shown
  footerCopyright: shown

materialCredits:
  summaryLabel: "Источник изображения"
  pageTitle: "Источники материалов"
  pageDescription: "Источники изображений и других материалов этого сайта."
  emptyMessage: "Пока нет опубликованных материалов с отдельным указанием источника."
  detailsLabel: "Подробнее"
  createdBy: "Автор"
  createdWith: "Создано с помощью"
  promptBy: "Промпт/процесс"
  reviewedBy: "Проверено"
  license: "Права"
  copyrightLabel: "Указание прав"
  rightsHolder: "Правообладатель"
  sourceType: "Источник"
  sourceTypeLabels:
    human-made: "Собственное производство"
    ai-assisted: "С помощью ИИ"
    ai-generated: "Создано ИИ"
    composite: "Составной материал"
    third-party: "Сторонний источник"
    commissioned: "По заказу"
    licensed-third-party: "По лицензии (сторонний источник)"
    customer-supplied: "Материал клиента"
    public-domain: "Общественное достояние"
    screenshot: "Снимок экрана"
  statusLabels:
    active: "Активен"
    orphaned: "Не используется"
    needs-review: "Ожидает проверки"
    blocked: "Заблокирован"
    expired: "Срок истёк"
  usageBasisLabels:
    internal-commissioned: "Собственное производство"
    express-permission: "Явное разрешение"
    license: "Лицензия"
    customer-supplied: "Материал клиента"
    public-domain: "Общественное достояние"
    statutory-exception: "Исключение по закону"
    quotation-right: "Право цитирования"
    unverified: "Не проверено"
  aiUsageLabels:
    aiGenerated: "Создано ИИ"
    aiAssisted: "С помощью ИИ"
    humanContribution: "Вклад человека"
    copyrightClaimed: "Авторское право заявлено"
    copyrightNotClaimed: "Авторское право не заявлено"
  partyKindLabels:
    Person: "Человек"
    Organization: "Организация"
    AIAgent: "ИИ-агент"
    AIModel: "ИИ-модель"
    AIPlatform: "ИИ-платформа"
    Workflow: "Рабочий процесс"
    SourceMaterial: "Исходный материал"
  usedOnLabel: "Используется на"
  verifiedAtLabel: "Проверено"
  noPreviewLabel: "Нет предпросмотра"
  copyrightExplanation: "Если не указано иное, все права защищены."
`;

const UZ_LABELS = `brandLabel: "E2E Valid"
brandAriaLabel: "E2E Valid GmbH — bosh sahifa"

header:
  ctaLabel: "Aloqa"
  motto: "Adolatli narxda isbotlangan sifat"
  navIds:
    - about
    - contacts

footer:
  statusLinkTitleSuffix: "Tizim holati"
  statusLinkAriaLabelSuffix: "Tizim holati"
  statusIconAriaLabel: "Tizim holati"
  taglineLines:
    - "Germaniyadagi savdo kompaniyasi."
    - "Kompaniya haqidagi axborot sayti."
  motto: "axborot · sayt orqali savdo yoʻq"
  navIds:
    - home
    - about
    - contacts
  legalIds:
    - credits
  contactIds:
    - email
  navGroups:
    navigationTitle: "NAVIGATSIYA"
    legalTitle: "HUQUQIY MAʼLUMOT"
    contactTitle: "ALOQA"

copyright:
  symbol: "©"
  yearFirst: 2026
  holder: "E2E Valid GmbH"

langSwitcher:
  switchAriaLabel: "{currentLang} — tilni {lang} ga almashtirish"

breadcrumbs:
  homeLabel: "Bosh sahifa"
  navAriaLabel: "Navigatsiya zanjiri"

sections:
  heroDecisionCard:
    decisionCardAriaLabel: "Asosiy maʼlumotlar"
  priceCard:
    monthly: "Oyiga"
    yearly: "Yiliga"
    setup: "Ulanish"
    includesHeading: "Kiritilgan"

orchestrator:
  counters: false
  inlineNumbers: false
  reveal: false
  parallax: false
  stagger: false
  smoothScroll: true
attribution:
  credits: byIntent
  proseAuthorship: shown
  footerCopyright: shown

materialCredits:
  summaryLabel: "Rasm manbai"
  pageTitle: "Materiallar manbalari"
  pageDescription: "Bu saytdagi rasmlar va boshqa materiallarning manbalari."
  emptyMessage: "Hozircha alohida manba koʻrsatilgan materiallar yoʻq."
  detailsLabel: "Batafsil"
  createdBy: "Muallif"
  createdWith: "Yaratilgan"
  promptBy: "Prompt/jarayon"
  reviewedBy: "Tekshirilgan"
  license: "Huquqlar"
  copyrightLabel: "Mualliflik huquqi"
  rightsHolder: "Huquq egasi"
  sourceType: "Manba"
  sourceTypeLabels:
    human-made: "Oʻz ishlab chiqarish"
    ai-assisted: "AI yordamida"
    ai-generated: "AI tomonidan yaratilgan"
    composite: "Aralash material"
    third-party: "Uchinchi tomon manbai"
    commissioned: "Buyurtma asosida"
    licensed-third-party: "Litsenziya (uchinchi tomon)"
    customer-supplied: "Mijoz materiali"
    public-domain: "Ommaviy mulk"
    screenshot: "Ekran surati"
  statusLabels:
    active: "Faol"
    orphaned: "Ishlatilmaydi"
    needs-review: "Tekshirish kutilmoqda"
    blocked: "Bloklangan"
    expired: "Muddati tugagan"
  usageBasisLabels:
    internal-commissioned: "Oʻz ishlab chiqarish"
    express-permission: "Aniq ruxsat"
    license: "Litsenziya"
    customer-supplied: "Mijoz materiali"
    public-domain: "Ommaviy mulk"
    statutory-exception: "Qonuniy istisno"
    quotation-right: "Iqtibos huquqi"
    unverified: "Tekshirilmagan"
  aiUsageLabels:
    aiGenerated: "AI tomonidan yaratilgan"
    aiAssisted: "AI yordamida"
    humanContribution: "Inson hissasi"
    copyrightClaimed: "Mualliflik huquqi talab qilingan"
    copyrightNotClaimed: "Mualliflik huquqi talab qilinmagan"
  partyKindLabels:
    Person: "Shaxs"
    Organization: "Tashkilot"
    AIAgent: "AI agent"
    AIModel: "AI model"
    AIPlatform: "AI platforma"
    Workflow: "Ish jarayoni"
    SourceMaterial: "Manba materiali"
  usedOnLabel: "Ishlatilgan joy"
  verifiedAtLabel: "Tekshirilgan"
  noPreviewLabel: "Koʻrib chiqish yoʻq"
  copyrightExplanation: "Aks holda koʻrsatilmagan boʻlsa, barcha huquqlar himoyalangan."
`;

const DE_LABELS = `brandLabel: "E2E Demowerk"
brandAriaLabel: "E2E Demowerk GmbH — Startseite"

header:
  ctaLabel: "Kontakt"
  motto: "Nachweisbare Qualität zum fairen Preis"
  navIds:
    - about
    - contacts

footer:
  statusLinkTitleSuffix: "Systemstatus"
  statusLinkAriaLabelSuffix: "Systemstatus"
  statusIconAriaLabel: "Systemstatus"
  taglineLines:
    - "Handelsunternehmen aus Deutschland."
    - "Informationsseite über das Unternehmen."
  motto: "information · kein Verkauf über die Website"
  navIds:
    - home
    - about
    - contacts
  legalIds:
    - credits
  contactIds:
    - email
  navGroups:
    navigationTitle: "NAVIGATION"
    legalTitle: "RECHTLICHES"
    contactTitle: "KONTAKT"

copyright:
  symbol: "©"
  yearFirst: 2026
  holder: "E2E Demowerk GmbH"

langSwitcher:
  switchAriaLabel: "{currentLang} — Sprache wechseln zu {lang}"

breadcrumbs:
  homeLabel: "Startseite"
  navAriaLabel: "Brotkrumennavigation"

sections:
  heroDecisionCard:
    decisionCardAriaLabel: "Wichtigste Informationen"
  priceCard:
    monthly: "Pro Monat"
    yearly: "Pro Jahr"
    setup: "Einrichtung"
    includesHeading: "Enthalten"

orchestrator:
  counters: false
  inlineNumbers: false
  reveal: false
  parallax: false
  stagger: false
  smoothScroll: true
attribution:
  credits: byIntent
  proseAuthorship: shown
  footerCopyright: shown

materialCredits:
  summaryLabel: "Bildquelle"
  pageTitle: "Materialquellen"
  pageDescription: "Quellen der Bilder und anderer Materialien dieser Website."
  emptyMessage: "Noch keine Materialien mit separater Quellenangabe veröffentlicht."
  detailsLabel: "Details"
  createdBy: "Erstellt von"
  createdWith: "Erstellt mit"
  promptBy: "Prompt/Prozess"
  reviewedBy: "Geprüft von"
  license: "Rechte"
  copyrightLabel: "Rechteangabe"
  rightsHolder: "Rechteinhaber"
  sourceType: "Quelle"
  sourceTypeLabels:
    human-made: "Eigenproduktion"
    ai-assisted: "KI-unterstützt"
    ai-generated: "KI-generiert"
    composite: "Verbundmaterial"
    third-party: "Drittquelle"
    commissioned: "In Auftrag gegeben"
    licensed-third-party: "Lizenziert (Drittquelle)"
    customer-supplied: "Kundenmaterial"
    public-domain: "Gemeinfrei"
    screenshot: "Bildschirmfoto"
  statusLabels:
    active: "Aktiv"
    orphaned: "Nicht verwendet"
    needs-review: "Prüfung ausstehend"
    blocked: "Gesperrt"
    expired: "Abgelaufen"
  usageBasisLabels:
    internal-commissioned: "Eigenproduktion"
    express-permission: "Ausdrückliche Erlaubnis"
    license: "Lizenz"
    customer-supplied: "Kundenmaterial"
    public-domain: "Gemeinfrei"
    statutory-exception: "Gesetzliche Ausnahme"
    quotation-right: "Zitatrecht"
    unverified: "Ungeprüft"
  aiUsageLabels:
    aiGenerated: "KI-generiert"
    aiAssisted: "KI-unterstützt"
    humanContribution: "Menschlicher Anteil"
    copyrightClaimed: "Urheberrecht beansprucht"
    copyrightNotClaimed: "Urheberrecht nicht beansprucht"
  partyKindLabels:
    Person: "Person"
    Organization: "Organisation"
    AIAgent: "KI-Agent"
    AIModel: "KI-Modell"
    AIPlatform: "KI-Plattform"
    Workflow: "Arbeitsablauf"
    SourceMaterial: "Ausgangsmaterial"
  usedOnLabel: "Verwendet auf"
  verifiedAtLabel: "Geprüft am"
  noPreviewLabel: "Keine Vorschau"
  copyrightExplanation: "Sofern nicht anders angegeben, alle Rechte vorbehalten."
`;

const EN_LABELS = `brandLabel: "E2E Latinworks"
brandAriaLabel: "E2E Latinworks LLC — home page"

header:
  ctaLabel: "Contact"
  motto: "Verifiable quality at a fair price"
  navIds:
    - about
    - contacts

footer:
  statusLinkTitleSuffix: "System status"
  statusLinkAriaLabelSuffix: "System status"
  statusIconAriaLabel: "System status"
  taglineLines:
    - "A trading company."
    - "An informational site about the company."
  motto: "information · no sales through the site"
  navIds:
    - home
    - about
    - contacts
  legalIds:
    - credits
  contactIds:
    - email
  navGroups:
    navigationTitle: "NAVIGATION"
    legalTitle: "LEGAL"
    contactTitle: "CONTACT"

copyright:
  symbol: "©"
  yearFirst: 2026
  holder: "E2E Latinworks LLC"

langSwitcher:
  switchAriaLabel: "{currentLang} — switch language to {lang}"

breadcrumbs:
  homeLabel: "Home"
  navAriaLabel: "Breadcrumb navigation"

sections:
  heroDecisionCard:
    decisionCardAriaLabel: "Key facts"
  priceCard:
    monthly: "Per month"
    yearly: "Per year"
    setup: "Setup"
    includesHeading: "Included"

orchestrator:
  counters: false
  inlineNumbers: false
  reveal: false
  parallax: false
  stagger: false
  smoothScroll: true
attribution:
  credits: byIntent
  proseAuthorship: shown
  footerCopyright: shown

materialCredits:
  summaryLabel: "Image source"
  pageTitle: "Material sources"
  pageDescription: "Sources of images and other materials on this site."
  emptyMessage: "No materials with a separate source note published yet."
  detailsLabel: "Details"
  createdBy: "Created by"
  createdWith: "Created with"
  promptBy: "Prompt/process"
  reviewedBy: "Reviewed by"
  license: "Rights"
  copyrightLabel: "Copyright notice"
  rightsHolder: "Rights holder"
  sourceType: "Source"
  sourceTypeLabels:
    human-made: "Human-made"
    ai-assisted: "AI-assisted"
    ai-generated: "AI-generated"
    composite: "Composite"
    third-party: "Third-party"
    commissioned: "Commissioned"
    licensed-third-party: "Licensed third-party"
    customer-supplied: "Customer-supplied"
    public-domain: "Public domain"
    screenshot: "Screenshot"
  statusLabels:
    active: "Active"
    orphaned: "Orphaned"
    needs-review: "Needs review"
    blocked: "Blocked"
    expired: "Expired"
  usageBasisLabels:
    internal-commissioned: "Internal commissioned"
    express-permission: "Express permission"
    license: "License"
    customer-supplied: "Customer-supplied"
    public-domain: "Public domain"
    statutory-exception: "Statutory exception"
    quotation-right: "Quotation right"
    unverified: "Unverified"
  aiUsageLabels:
    aiGenerated: "AI generated"
    aiAssisted: "AI assisted"
    humanContribution: "Human contribution"
    copyrightClaimed: "Copyright claimed"
    copyrightNotClaimed: "Copyright not claimed"
  partyKindLabels:
    Person: "Person"
    Organization: "Organization"
    AIAgent: "AI agent"
    AIModel: "AI model"
    AIPlatform: "AI platform"
    Workflow: "Workflow"
    SourceMaterial: "Source material"
  usedOnLabel: "Used on"
  verifiedAtLabel: "Verified at"
  noPreviewLabel: "No preview available"
  copyrightExplanation: "Unless stated otherwise, all rights reserved."
`;

const fixtures: FixtureSpec[] = [
  {
    name: "valid-minimal",
    app: "dp7",
    legalName: "DP7 Digitalprojekt GmbH",
    businessId: "dp7",
    email: "e2e-valid@example.com",
    place: {
      street: "Chausseestraße",
      streetNumber: "86",
      postalCode: "10115",
      locality: "Berlin",
      countryCode: "DE",
    },
    segments: ["ru", "uz"],
    legalPages: ["impressum", "datenschutz"],
    nativeNames: { ru: "Русский", uz: "Oʻzbekcha" },
    faq: {
      heading: { ru: "Частые вопросы", uz: "Kop soʻraladigan savollar" },
      items: {
        ru: [
          {
            q: "Чем занимается компания?",
            a: "Информационный сайт о компании и её деятельности; продажа через сайт не ведётся.",
          },
          {
            q: "Как связаться с компанией?",
            a: "Через страницу контактов — там указаны электронная почта и адрес офиса.",
          },
        ],
        uz: [
          {
            q: "Kompaniya nima bilan shugʻullanadi?",
            a: "Kompaniya va uning faoliyati haqida axborot sayti; sayt orqali sotuv olib borilmaydi.",
          },
          {
            q: "Kompaniya bilan qanday bogʻlanish mumkin?",
            a: "Aloqa sahifasi orqali — u yerda elektron pochta va ofis manzili koʻrsatilgan.",
          },
        ],
      },
    },
    service: {
      name: {
        ru: "Информационные материалы о компании",
        uz: "Kompaniya haqida axborot materiallari",
      },
      description: {
        ru: "Описание компании, её профиля и способов связи для деловых партнёров.",
        uz: "Kompaniya, uning profili va biznes hamkorlari uchun aloqa usullari tavsifi.",
      },
    },
    tagline: { ru: "Проверяемое качество по честной цене" },
    defaultDescription: {
      ru: "Информационный сайт E2E Valid GmbH: компания, страницы и способы связи.",
      uz: "E2E Valid GmbH axborot sayti: kompaniya, sahifalar va aloqa usullari.",
    },
    skipLinkLabel: { ru: "Перейти к содержимому", uz: "Asosiy mazmunga oʻtish" },
    pages: [
      {
        pageId: "home",
        semanticType: "home",
        star: "Polaris",
        planet: "Hyperion",
        routes: { ru: "", uz: "" },
        title: {
          ru: "E2E Valid GmbH — главная",
          uz: "E2E Valid GmbH — bosh sahifa",
        },
        description: {
          ru: "Информационный сайт E2E Valid GmbH: кто мы и что мы делаем.",
          uz: "E2E Valid GmbH axborot sayti: biz kimmiz va nima qilamiz.",
        },
        heading: { ru: "Чем мы занимаемся", uz: "Biz nima qilamiz" },
        prose: "home-intro",
      },
      {
        pageId: "about",
        semanticType: "about",
        star: "Mirach",
        planet: "Hyperion",
        routes: { ru: "o-kompanii", uz: "kompaniya-haqida" },
        title: {
          ru: "О компании | E2E Valid GmbH",
          uz: "Kompaniya haqida | E2E Valid GmbH",
        },
        description: {
          ru: "Сведения о компании E2E Valid GmbH и об этом сайте.",
          uz: "E2E Valid GmbH va bu sayt haqida maʼlumot: kompaniya va sahifalar.",
        },
        heading: { ru: "О компании", uz: "Kompaniya haqida" },
        prose: "about-company",
      },
      {
        pageId: "contacts",
        semanticType: "content",
        star: "Alphard",
        planet: "Hyperion",
        routes: { ru: "kontakty", uz: "aloqa" },
        title: {
          ru: "Контакты | E2E Valid GmbH",
          uz: "Aloqa | E2E Valid GmbH",
        },
        description: {
          ru: "Как связаться с E2E Valid GmbH: электронная почта, адрес и время ответа.",
          uz: "E2E Valid GmbH bilan qanday bogʻlanish mumkin: elektron pochta va manzil.",
        },
        heading: { ru: "Контакты", uz: "Aloqa" },
        prose: "contacts",
      },
      {
        pageId: "credits",
        semanticType: "content",
        star: "Polaris",
        planet: "Makemake",
        credits: true,
        llmsExclude: true,
        routes: { ru: "istochniki-materialov", uz: "material-manbalari" },
        title: {
          ru: "Источники материалов | E2E Valid GmbH",
          uz: "Materiallar manbalari | E2E Valid GmbH",
        },
        description: {
          ru: "Источники изображений и других материалов этого сайта.",
          uz: "Bu saytdagi rasmlar va boshqa materiallar manbalari.",
        },
        heading: { ru: "Источники материалов", uz: "Materiallar manbalari" },
        lead: {
          ru: "Источники изображений и других материалов этого сайта.",
          uz: "Bu saytdagi rasmlar va boshqa materiallar manbalari.",
        },
      },
    ],
    proseTexts: {
      "home-intro": {
        ru: "=(business-profile.organization/legal-identity.legalName) — торговая компания из Германии.\n\nЭтот сайт носит информационный характер: здесь нет заказов, цен и сведений о наличии товаров.",
        uz: "=(business-profile.organization/legal-identity.legalName) — Germaniyadagi savdo kompaniyasi.\n\nBu sayt faqat axborot xarakteriga ega: bu yerda buyurtmalar, narxlar va mavjudlik maʼlumotlari yoʻq.",
      },
      "about-company": {
        ru: "=(business-profile.organization/legal-identity.legalName) — небольшая торговая компания. Мы работаем с партнёрами в Германии и за её пределами.\n\nСайт рассказывает о компании и способах связи с нами.",
        uz: "=(business-profile.organization/legal-identity.legalName) — kichik savdo kompaniyasi. Biz Germaniyada va undan tashqarida hamkorlar bilan ishlaymiz.\n\nSayt kompaniya va biz bilan bogʻlanish usullari haqida hikoya qiladi.",
      },
      contacts: {
        ru: "Электронная почта и адрес компании указаны ниже.\n\nМы отвечаем на запросы в рабочие дни.",
        uz: "Kompaniyaning elektron pochtasi va manzili quyida keltirilgan.\n\nBiz ish kunlari soʻrovlarga javob beramiz.",
      },
    },
    navLabels: {
      home: { ru: "Главная", uz: "Bosh sahifa" },
      about: { ru: "О компании", uz: "Kompaniya haqida" },
      contacts: { ru: "Контакты", uz: "Aloqa" },
      credits: { ru: "Источники материалов", uz: "Materiallar manbalari" },
    },
    labels: (seg) => (seg === "ru" ? RU_LABELS : UZ_LABELS),
  },
  {
    name: "de-domain",
    app: "de-domain",
    legalName: "E2E Demowerk GmbH",
    businessId: "demowerk",
    email: "e2e-demowerk@example.com",
    domain: "e2e-de-domain.warpgogol.com",
    place: {
      street: "Friedrichstraße",
      streetNumber: "12",
      postalCode: "10117",
      locality: "Berlin",
      countryCode: "DE",
    },
    segments: ["de", "en"],
    legalPages: ["impressum", "datenschutz"],
    faq: {
      heading: { de: "Häufige Fragen", en: "Frequently asked questions" },
      items: {
        de: [
          {
            q: "Was macht das Unternehmen?",
            a: "Informationswebsite über das Unternehmen und seine Tätigkeit; ein Verkauf über die Website erfolgt nicht.",
          },
          {
            q: "Wie erreicht man das Unternehmen?",
            a: "Über die Kontaktseite — dort stehen E-Mail-Adresse und Postanschrift.",
          },
        ],
        en: [
          {
            q: "What does the company do?",
            a: "An informational site about the company and its work; nothing is sold through the website.",
          },
          {
            q: "How can the company be reached?",
            a: "Via the contact page — it lists the email address and the postal address.",
          },
        ],
      },
    },
    service: {
      name: {
        de: "Informationsmaterialien zum Unternehmen",
        en: "Informational materials about the company",
      },
      description: {
        de: "Beschreibung des Unternehmens, seines Profils und der Kontaktmöglichkeiten für Geschäftspartner.",
        en: "A description of the company, its profile, and the contact channels for business partners.",
      },
    },
    nativeNames: { de: "Deutsch", en: "English" },
    tagline: { de: "Nachweisbare Qualität zum fairen Preis" },
    defaultDescription: {
      de: "Informationsseite der E2E Demowerk GmbH: Unternehmen, Seiten und Kontakt.",
      en: "Informational site of E2E Demowerk GmbH: company, pages, and contact.",
    },
    skipLinkLabel: { de: "Zum Inhalt springen", en: "Skip to content" },
    pages: [
      {
        pageId: "home",
        semanticType: "home",
        star: "Polaris",
        planet: "Hyperion",
        routes: { de: "", en: "" },
        title: {
          de: "E2E Demowerk GmbH — Startseite",
          en: "E2E Demowerk GmbH — home",
        },
        description: {
          de: "Informationsseite der E2E Demowerk GmbH: wer wir sind und was wir tun.",
          en: "Informational site of E2E Demowerk GmbH: who we are and what we do.",
        },
        heading: { de: "Was wir tun", en: "What we do" },
        prose: "home-intro",
      },
      {
        pageId: "about",
        semanticType: "about",
        star: "Mirach",
        planet: "Hyperion",
        routes: { de: "ueber-uns", en: "about" },
        title: {
          de: "Über uns | E2E Demowerk GmbH",
          en: "About us | E2E Demowerk GmbH",
        },
        description: {
          de: "Informationen über die E2E Demowerk GmbH und diese Website.",
          en: "Information about E2E Demowerk GmbH and this website.",
        },
        heading: { de: "Über uns", en: "About us" },
        prose: "about-company",
      },
      {
        pageId: "contacts",
        semanticType: "content",
        star: "Alphard",
        planet: "Hyperion",
        routes: { de: "kontakt", en: "contact" },
        title: {
          de: "Kontakt | E2E Demowerk GmbH",
          en: "Contact | E2E Demowerk GmbH",
        },
        description: {
          de: "So erreichen Sie die E2E Demowerk GmbH: E-Mail, Anschrift und Antwortzeiten.",
          en: "How to reach E2E Demowerk GmbH: email address, postal address, and hours.",
        },
        heading: { de: "Kontakt", en: "Contact" },
        prose: "contacts",
      },
      {
        pageId: "credits",
        semanticType: "content",
        star: "Polaris",
        planet: "Makemake",
        credits: true,
        llmsExclude: true,
        routes: { de: "materialquellen", en: "credits" },
        title: {
          de: "Materialquellen | E2E Demowerk GmbH",
          en: "Material sources | E2E Demowerk GmbH",
        },
        description: {
          de: "Quellen der Bilder und anderer Materialien dieser Website.",
          en: "Sources of images and other materials on this site.",
        },
        heading: { de: "Materialquellen", en: "Material sources" },
        lead: {
          de: "Quellen der Bilder und anderer Materialien dieser Website.",
          en: "Sources of images and other materials on this site.",
        },
      },
    ],
    proseTexts: {
      "home-intro": {
        de: "=(business-profile.organization/legal-identity.legalName) ist ein Handelsunternehmen aus Deutschland.\n\nDiese Website dient der Information: Es gibt keine Bestellungen, Preise oder Verfügbarkeitsangaben.",
        en: "=(business-profile.organization/legal-identity.legalName) is a trading company from Germany.\n\nThis website is informational only: there are no orders, prices, or availability details.",
      },
      "about-company": {
        de: "=(business-profile.organization/legal-identity.legalName) ist ein kleines Handelsunternehmen. Wir arbeiten mit Partnern in Deutschland und darüber hinaus.\n\nDie Website informiert über das Unternehmen und die Kontaktmöglichkeiten.",
        en: "=(business-profile.organization/legal-identity.legalName) is a small trading company. We work with partners in Germany and beyond.\n\nThe website describes the company and how to get in touch.",
      },
      contacts: {
        de: "E-Mail-Adresse und Anschrift des Unternehmens finden Sie unten.\n\nWir beantworten Anfragen an Werktagen.",
        en: "The company's email address and postal address are listed below.\n\nWe respond to inquiries on business days.",
      },
    },
    navLabels: {
      home: { de: "Startseite", en: "Home" },
      about: { de: "Über uns", en: "About us" },
      contacts: { de: "Kontakt", en: "Contact" },
      credits: { de: "Materialquellen", en: "Material sources" },
    },
    labels: (seg) => (seg === "de" ? DE_LABELS : EN_LABELS),
  },
  {
    name: "latin-only",
    app: "latin-only",
    legalName: "E2E Latinworks LLC",
    businessId: "latinworks",
    email: "e2e-latinworks@example.com",
    domain: "e2e-latin-only.warpgogol.com",
    place: {
      street: "SW Morrison Street",
      streetNumber: "1500",
      postalCode: "97205",
      locality: "Portland",
      countryCode: "US",
    },
    segments: ["en"],
    faq: {
      heading: { en: "Frequently asked questions" },
      items: {
        en: [
          {
            q: "What does the company do?",
            a: "An informational site about the company; nothing is sold through the website.",
          },
          {
            q: "How can the company be reached?",
            a: "Via the contact page, which lists email and postal addresses.",
          },
        ],
      },
    },
    service: {
      name: { en: "Company information materials" },
      description: {
        en: "A description of the company, its profile, and the contact channels for business partners.",
      },
    },
    nativeNames: { en: "English" },
    tagline: { en: "Verifiable quality at a fair price" },
    defaultDescription: {
      en: "Informational site of E2E Latinworks LLC: company, pages, and contact.",
    },
    skipLinkLabel: { en: "Skip to content" },
    pages: [
      {
        pageId: "home",
        semanticType: "home",
        star: "Polaris",
        planet: "Hyperion",
        routes: { en: "" },
        title: { en: "E2E Latinworks LLC — home" },
        description: {
          en: "Informational site of E2E Latinworks LLC: who we are and what we do.",
        },
        heading: { en: "What we do" },
        prose: "home-intro",
      },
      {
        pageId: "about",
        semanticType: "about",
        star: "Mirach",
        planet: "Hyperion",
        routes: { en: "about" },
        title: { en: "About us | E2E Latinworks LLC" },
        description: {
          en: "Information about E2E Latinworks LLC and the purpose of this website.",
        },
        heading: { en: "About us" },
        prose: "about-company",
      },
      {
        pageId: "contacts",
        semanticType: "content",
        star: "Alphard",
        planet: "Hyperion",
        routes: { en: "contact" },
        title: { en: "Contact | E2E Latinworks LLC" },
        description: { en: "How to reach E2E Latinworks LLC: email address and postal address." },
        heading: { en: "Contact" },
        prose: "contacts",
      },
      {
        pageId: "credits",
        semanticType: "content",
        star: "Polaris",
        planet: "Makemake",
        credits: true,
        llmsExclude: true,
        routes: { en: "credits" },
        title: { en: "Material sources | E2E Latinworks LLC" },
        description: { en: "Sources of images and other materials on this site." },
        heading: { en: "Material sources" },
        lead: { en: "Sources of images and other materials on this site." },
      },
    ],
    proseTexts: {
      "home-intro": {
        en: "=(business-profile.organization/legal-identity.legalName) is a trading company.\n\nThis website is informational only: there are no orders, prices, or availability details.",
      },
      "about-company": {
        en: "=(business-profile.organization/legal-identity.legalName) is a small trading company. We work with partners in our region and beyond.\n\nThe website describes the company and how to get in touch.",
      },
      contacts: {
        en: "The company's email address and postal address are listed below.\n\nWe respond to inquiries on business days.",
      },
    },
    navLabels: {
      home: { en: "Home" },
      about: { en: "About us" },
      contacts: { en: "Contact" },
      credits: { en: "Material sources" },
    },
    labels: () => EN_LABELS,
  },
];

for (const spec of fixtures) {
  const dir = join(root, spec.name, "composition");
  const files: Record<string, string> = {
    "system.md": systemMdOverlay(spec),
    "image-delivery.config.yaml": imageDeliveryConfig(spec),
    ...businessProfileFiles(spec),
  };
  for (const seg of spec.segments) {
    for (const p of spec.pages) {
      files[`pages/${seg}/${p.pageId.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`)}.md`] =
        pageFile(spec, p, seg);
    }
    for (const [proseId, texts] of Object.entries(spec.proseTexts)) {
      files[`prose/${seg}/${proseId}.md`] =
        `---\nkind: prose\nlang: ${seg}\n---\n\n${texts[seg]}\n`;
    }
    files[`navigation/${seg}/navigation.md`] = navFile(spec, seg);
    files[`site/${seg}/labels.md`] = fm(spec.labels(seg));
    files[`site/${seg}/layout.md`] = layoutFile(spec, seg);
    // faq/{seg}/ entries — the home faq-list block aggregates them into the
    // FAQPage JSON-LD the family baseline requires.
    for (const [i, item] of (spec.faq?.items[seg] ?? []).entries()) {
      files[`faq/${seg}/q${i + 1}.md`] = `---
slug: "q${i + 1}"
question: "${item.q}"
answer: "${item.a}"
order: ${i + 1}
---
`;
    }
    // PBP product (kind: service) — projected by buildPbpSemanticProfile into
    // organization.services, the render-path source of the Service JSON-LD
    // node the family baseline requires.
    if (spec.service) {
      files[`business-profile/${seg}/products/information-materials.md`] = `---
schema: pbp/product@1
id: product/information-materials
type: product
status: published
kind: service
name: "${spec.service.name[seg] ?? spec.service.name[spec.segments[0]!]}"
summary: "${spec.service.description[seg] ?? spec.service.description[spec.segments[0]!]}"
governance:
  authorityRef: pbp/business@1:business/${spec.businessId}
---
`;
    }
  }
  emit(dir, files);
  console.log(`${spec.name}: ${Object.keys(files).length} files`);
}
