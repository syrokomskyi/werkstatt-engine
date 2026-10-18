---
identity:
  tagline: "Verifiable quality at a fair price"
  ctaTarget: contacts

i18n:
  supported:
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
      en: ""
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: about
    semanticType: about
    output:
      sitemap: { category: content, lastmod: "2026-10-17", includeLastmod: true }
    routes:
      en: "about"
    cosmicStar: Mirach
    planets:
      - { cosmicPlanet: Hyperion, pin: "latest" }

  - pageId: contacts
    semanticType: content
    output:
      sitemap: { category: content, lastmod: "2026-10-17", includeLastmod: true }
    routes:
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
      en: "credits"
    cosmicStar: Polaris
    planets:
      - { cosmicPlanet: Makemake, pin: "latest" }

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
