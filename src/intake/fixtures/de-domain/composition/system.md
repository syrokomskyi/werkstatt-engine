---
identity:
  tagline: "Nachweisbare Qualität zum fairen Preis"
  ctaTarget: contacts
  legal:
    responsibleName: "E2E Demowerk GmbH"
    address: "Friedrichstraße 12, 10117 Berlin, DE"
    email: "e2e-demowerk@example.com"

i18n:
  supported:
    de: { name: "Deutsch" }
    en: { name: "English" }

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
      de: ""
      en: ""
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: about
    semanticType: about
    output:
      sitemap: { category: content, lastmod: "2026-10-17", includeLastmod: true }
    routes:
      de: "ueber-uns"
      en: "about"
    cosmicStar: Mirach
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: contacts
    semanticType: content
    output:
      sitemap: { category: content, lastmod: "2026-10-17", includeLastmod: true }
    routes:
      de: "kontakt"
      en: "contact"
    cosmicStar: Alphard
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: credits
    semanticType: content
    output:
      sitemap: { category: legal, lastmod: "2026-10-17", includeLastmod: false }
      llms: exclude
    routes:
      de: "materialquellen"
      en: "credits"
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Makemake, pin: "latest" }

  - pageId: impressum
    semanticType: legal
    output:
      sitemap: { category: legal, lastmod: "2026-10-17", includeLastmod: false }
      llms: exclude
    routes:
      de: "impressum"
      en: "impressum"
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: datenschutz
    semanticType: legal
    output:
      sitemap: { category: legal, lastmod: "2026-10-17", includeLastmod: false }
      llms: exclude
    routes:
      de: "datenschutz"
      en: "datenschutz"
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
