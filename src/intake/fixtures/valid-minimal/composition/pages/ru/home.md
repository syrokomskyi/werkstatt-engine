---
kind: page
pageId: home
cosmicStar: Polaris
title: "E2E Valid GmbH — главная"
description: "Информационный сайт E2E Valid GmbH: кто мы и что мы делаем."
lang: ru
blocks:
  - id: home-content
    type: markdown
    props:
      hideSectionNumber: true
      heading: "Чем мы занимаемся"
      level: 1
      contentRef: "prose/home-intro"
  - id: home-faq
    type: faq-list
    props:
      header:
        heading: "Частые вопросы"
      background:
        kind: transparent
---
