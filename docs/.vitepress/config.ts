import { defineConfig } from "vitepress";

export default defineConfig({
  title: "rivet-ts",
  description: "Write a TypeScript contract, scaffold a Hono app, generate a client, and promote later.",
  base: "/rivet-ts/",

  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Reference", link: "/reference/cli" },
      { text: "GitHub", link: "https://github.com/maxanstey-meridian/rivet-ts" },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is rivet-ts?", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Hono", link: "/guides/hono" },
          { text: "Vite Plugin", link: "/guides/vite-plugin" },
          { text: "Sample App", link: "/guides/sample-app" },
          { text: "Zero to API in 5 Minutes", link: "/guides/tutorial" },
          { text: "Local Now, Bun Later", link: "/guides/local-now-server-later" },
          { text: "OpenAPI and Validators", link: "/guides/openapi-and-validators" },
          { text: ".NET Handoff", link: "/guides/dotnet-handoff" },
          { text: "Examples", link: "/guides/examples" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Supported Shapes", link: "/reference/supported" },
          { text: "Unsupported Shapes", link: "/reference/unsupported" },
        ],
      },
      {
        text: "Misc",
        items: [
          { text: "How It Works", link: "/misc/how-it-works" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/maxanstey-meridian/rivet-ts" },
    ],

    search: {
      provider: "local",
    },
  },
});
