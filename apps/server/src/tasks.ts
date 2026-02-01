import type { Task } from "@loopless/shared";

export const TASKS: Task[] = [
  // ===== SauceDemo Tasks =====
  {
    id: "saucedemo-checkout",
    name: "SauceDemo Checkout",
    description: "Login with username 'standard_user' and password 'secret_sauce', add items to cart, go to cart, proceed to checkout, fill checkout info (First: Test, Last: User, Zip: 12345), continue, and click Finish to complete purchase",
    start_url: "https://www.saucedemo.com/",
    success_condition: {
      page_contains: "THANK YOU",
      url_contains: "checkout-complete",
    },
    max_steps: 50,
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
  
  // ===== GoCalendar Tasks (AGI Benchmark) =====
  {
    id: "gocalendar-1",
    name: "GoCalendar - Edit Event",
    description: "Change the 'Team Check-In' event on July 18, 2024, to 'Project Kickoff' and update the location to 'Zoom'",
    start_url: "https://real-gocalendar.vercel.app/",
    success_condition: {
      page_contains: "Project Kickoff",
    },
    max_steps: 30,
    domain: "real-gocalendar.vercel.app",
    intent: "edit-event",
  },
  {
    id: "gocalendar-2",
    name: "GoCalendar - Create Event",
    description: "Create a new event titled 'Team Meeting' on July 19, 2024, from 2 PM to 2:30 PM, with location 'Conference Room A'",
    start_url: "https://real-gocalendar.vercel.app/",
    success_condition: {
      page_contains: "Team Meeting",
    },
    max_steps: 35,
    domain: "real-gocalendar.vercel.app",
    intent: "create-event",
  },
  {
    id: "gocalendar-9",
    name: "GoCalendar - Recurring Event",
    description: "Create a recurring 'Daily Standup' event at 9am on July 18, 2024, that repeats daily, then adjust the July 22 event to start at 10 AM",
    start_url: "https://real-gocalendar.vercel.app/",
    success_condition: {
      page_contains: "Daily Standup",
    },
    max_steps: 40,
    domain: "real-gocalendar.vercel.app",
    intent: "recurring-event",
  },
  {
    id: "gocalendar-10",
    name: "GoCalendar - Weekday Event",
    description: "Create an event 'Take Vitamins', repeating every weekday from 8AM-9AM with description 'Vitamin B, D', selecting the 'Personal' calendar",
    start_url: "https://real-gocalendar.vercel.app/",
    success_condition: {
      page_contains: "Take Vitamins",
    },
    max_steps: 40,
    domain: "real-gocalendar.vercel.app",
    intent: "weekday-event",
  },
  
  // ===== GoMail Tasks (AGI Benchmark) =====
  {
    id: "gomail-1",
    name: "GoMail - Count Unread",
    description: "Find how many unread emails are in the Inbox (answer: 437)",
    start_url: "https://real-gomail.vercel.app/",
    success_condition: {},
    max_steps: 20,
    domain: "real-gomail.vercel.app",
    intent: "count-unread",
  },
  {
    id: "gomail-5",
    name: "GoMail - Compose Email",
    description: "Compose and send a new email to a contact",
    start_url: "https://real-gomail.vercel.app/",
    success_condition: {
      page_contains: "sent",
    },
    max_steps: 25,
    domain: "real-gomail.vercel.app",
    intent: "compose-email",
  },
  {
    id: "gomail-6",
    name: "GoMail - Delete Email",
    description: "Delete an email from the inbox",
    start_url: "https://real-gomail.vercel.app/",
    success_condition: {},
    max_steps: 20,
    domain: "real-gomail.vercel.app",
    intent: "delete-email",
  },
  {
    id: "gomail-7",
    name: "GoMail - Archive Email",
    description: "Archive an email from the inbox",
    start_url: "https://real-gomail.vercel.app/",
    success_condition: {},
    max_steps: 20,
    domain: "real-gomail.vercel.app",
    intent: "archive-email",
  },
  
  // ===== MarriSuite Tasks (AGI Benchmark) =====
  {
    id: "marrisuite-1",
    name: "MarriSuite - Book Room",
    description: "Book a hotel room for 2 nights",
    start_url: "https://real-marrisuite.vercel.app/",
    success_condition: {
      page_contains: "confirmed",
    },
    max_steps: 35,
    domain: "real-marrisuite.vercel.app",
    intent: "book-hotel",
  },
  {
    id: "marrisuite-4",
    name: "MarriSuite - Search Hotels",
    description: "Search for available hotels in a specific location",
    start_url: "https://real-marrisuite.vercel.app/",
    success_condition: {
      url_contains: "search",
    },
    max_steps: 25,
    domain: "real-marrisuite.vercel.app",
    intent: "search-hotels",
  },
  {
    id: "marrisuite-5",
    name: "MarriSuite - Filter Results",
    description: "Apply filters to hotel search results (price, amenities)",
    start_url: "https://real-marrisuite.vercel.app/",
    success_condition: {},
    max_steps: 30,
    domain: "real-marrisuite.vercel.app",
    intent: "filter-hotels",
  },
  {
    id: "marrisuite-10",
    name: "MarriSuite - View Reservation",
    description: "View details of an existing hotel reservation",
    start_url: "https://real-marrisuite.vercel.app/",
    success_condition: {
      url_contains: "reservation",
    },
    max_steps: 25,
    domain: "real-marrisuite.vercel.app",
    intent: "view-reservation",
  },
  
  // ===== NetworkIn Tasks (AGI Benchmark) =====
  {
    id: "networkin-1",
    name: "NetworkIn - View Profile",
    description: "Navigate to a user profile and view their connections",
    start_url: "https://real-networkin.vercel.app/",
    success_condition: {
      url_contains: "/profile",
    },
    max_steps: 25,
    domain: "real-networkin.vercel.app",
    intent: "view-profile",
  },
  {
    id: "networkin-8",
    name: "NetworkIn - Send Message",
    description: "Send a message to a connection",
    start_url: "https://real-networkin.vercel.app/",
    success_condition: {
      page_contains: "sent",
    },
    max_steps: 30,
    domain: "real-networkin.vercel.app",
    intent: "send-message",
  },
  {
    id: "networkin-13",
    name: "NetworkIn - Search Jobs",
    description: "Search for job listings and apply filters",
    start_url: "https://real-networkin.vercel.app/",
    success_condition: {
      url_contains: "jobs",
    },
    max_steps: 25,
    domain: "real-networkin.vercel.app",
    intent: "search-jobs",
  },
  {
    id: "networkin-15",
    name: "NetworkIn - Update Profile",
    description: "Update profile information (headline, summary)",
    start_url: "https://real-networkin.vercel.app/",
    success_condition: {},
    max_steps: 30,
    domain: "real-networkin.vercel.app",
    intent: "update-profile",
  },
];

export function getTask(id: string): Task | undefined {
  return TASKS.find((t) => t.id === id);
}

export function listTasks(): Task[] {
  return TASKS;
}
