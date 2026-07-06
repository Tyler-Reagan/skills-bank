import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Skills Bank",
  description: "One registry. Every AI agent on your machine.",
  srcDir: ".",
  outDir: "./dist",
  cleanUrls: true,

  head: [["link", { rel: "icon", href: "/icon.svg" }]],

  themeConfig: {
    logo: "/icon.svg",

    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Concepts", link: "/concepts" },
      {
        text: "Download",
        link: "https://github.com/Tyler-Reagan/skills-bank/releases",
      },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Concepts", link: "/concepts" },
        ],
      },
      {
        text: "Everyday",
        collapsed: false,
        items: [
          { text: "Browse & install skills", link: "/guides/install" },
          { text: "Register a skill", link: "/guides/register" },
          { text: "Manage agent links", link: "/guides/manage-links" },
          { text: "Pull registry updates", link: "/guides/sync" },
          { text: "Track skill usage", link: "/guides/metrics" },
        ],
      },
      {
        text: "Advanced",
        collapsed: true,
        items: [
          { text: "Sign in with GitHub", link: "/guides/sign-in" },
          { text: "Move your registry", link: "/guides/manifest" },
          { text: "Heal bad states", link: "/guides/heal" },
          { text: "Unregister a skill", link: "/guides/unregister" },
        ],
      },
      {
        text: "Reference",
        collapsed: true,
        items: [
          { text: "Keyboard shortcuts", link: "/reference/keyboard" },
          { text: "Skill labels", link: "/reference/labels" },
          { text: "Skill metadata", link: "/reference/skill-metadata" },
          { text: "Troubleshooting", link: "/reference/troubleshooting" },
        ],
      },
      {
        text: "Self-hosting",
        collapsed: true,
        items: [{ text: "Fork & self-host", link: "/self-host" }],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/Tyler-Reagan/skills-bank" },
    ],

    editLink: {
      pattern:
        "https://github.com/Tyler-Reagan/skills-bank/edit/main/packages/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024–present Tyler Reagan",
    },

    search: {
      provider: "local",
    },
  },
});
