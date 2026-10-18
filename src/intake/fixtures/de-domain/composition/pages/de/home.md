---
kind: page
pageId: home
cosmicStar: Polaris
title: "E2E Demowerk GmbH — Startseite"
description: "Informationsseite der E2E Demowerk GmbH: wer wir sind und was wir tun."
lang: de
blocks:
  - id: home-content
    type: markdown
    props:
      hideSectionNumber: true
      heading: "Was wir tun"
      level: 1
      contentRef: "prose/home-intro"
  - id: home-faq
    type: faq-list
    props:
      header:
        heading: "Häufige Fragen"
      background:
        kind: transparent
---
