---
kind: page
pageId: home
cosmicStar: Polaris
title: "E2E Demowerk GmbH — home"
description: "Informational site of E2E Demowerk GmbH: who we are and what we do."
lang: en
blocks:
  - id: home-content
    type: markdown
    props:
      hideSectionNumber: true
      heading: "What we do"
      level: 1
      contentRef: "prose/home-intro"
  - id: home-faq
    type: faq-list
    props:
      header:
        heading: "Frequently asked questions"
      background:
        kind: transparent
---
