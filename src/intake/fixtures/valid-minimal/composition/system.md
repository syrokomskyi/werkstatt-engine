---
identity:
  tagline: "Проверяемое качество по честной цене"
  ctaTarget: contacts
  legal:
    responsibleName: "DP7 Digitalprojekt GmbH"
    address: "Chausseestraße 86, 10115 Berlin, DE"
    email: "e2e-valid@example.com"

i18n:
  supported:
    ru: { name: "Русский" }
    uz: { name: "Oʻzbekcha" }

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
  - pageId: home
    semanticType: home
    output:
      sitemap: { category: content, lastmod: "2026-10-17", includeLastmod: true }
    routes:
      ru: ""
      uz: ""
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: about
    semanticType: about
    output:
      sitemap: { category: content, lastmod: "2026-10-17", includeLastmod: true }
    routes:
      ru: "o-kompanii"
      uz: "kompaniya-haqida"
    cosmicStar: Mirach
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: contacts
    semanticType: content
    output:
      sitemap: { category: content, lastmod: "2026-10-17", includeLastmod: true }
    routes:
      ru: "kontakty"
      uz: "aloqa"
    cosmicStar: Alphard
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: credits
    semanticType: content
    output:
      sitemap: { category: legal, lastmod: "2026-10-17", includeLastmod: false }
      llms: exclude
    routes:
      ru: "istochniki-materialov"
      uz: "material-manbalari"
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Makemake, pin: "latest" }

  - pageId: impressum
    semanticType: legal
    output:
      sitemap: { category: legal, lastmod: "2026-10-17", includeLastmod: false }
      llms: exclude
    routes:
      ru: "impressum"
      uz: "impressum"
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: datenschutz
    semanticType: legal
    output:
      sitemap: { category: legal, lastmod: "2026-10-17", includeLastmod: false }
      llms: exclude
    routes:
      ru: "datenschutz"
      uz: "datenschutz"
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

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
