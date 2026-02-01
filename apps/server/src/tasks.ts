import type { Task } from "@loopless/shared";

export const TASKS: Task[] = [
  {
    id: "saucedemo-checkout",
    name: "SauceDemo Checkout",
    description: "Login, add 2 items to cart, checkout, and complete purchase",
    start_url: "https://www.saucedemo.com/",
    success_condition: {
      page_contains: "THANK YOU",
      url_contains: "checkout-complete",
    },
    max_steps: 40,
    domain: "saucedemo.com",
    intent: "checkout",
  },
  {
    id: "hn-extract",
    name: "Hacker News Extract",
    description: "Extract top 5 story titles from Hacker News as JSON",
    start_url: "https://news.ycombinator.com",
    success_condition: {},
    max_steps: 15,
    domain: "news.ycombinator.com",
    intent: "extract",
  },
];

export function getTask(id: string): Task | undefined {
  return TASKS.find((t) => t.id === id);
}

export function listTasks(): Task[] {
  return TASKS;
}
