import { describe, expect, it } from "vitest";
import { isOperatorPlannerPrompt, mockOperatorPlannerResponse } from "./mock-operator-plan.js";

describe("mock operator planner", () => {
  it("plans a create-task command from a Russian @Vimla request", () => {
    const messages = [
      {
        content: `VIMLA_OPERATOR_PLANNER_V1\nUSER_REQUEST:\n@Vimla создай задачу купить билеты завтра\nWORKSPACE_SNAPSHOT:\n{"tasks":[]}`,
      },
    ];
    expect(isOperatorPlannerPrompt(messages)).toBe(true);
    const plan = JSON.parse(mockOperatorPlannerResponse(messages)) as {
      intent: string;
      commands: Array<{ tool: string }>;
    };
    expect(plan.intent).toBe("act");
    expect(plan.commands[0]?.tool).toBe("tasks.create");
  });

  it("clarifies an ambiguous reschedule and updates when an id is known", () => {
    const clarify = JSON.parse(
      mockOperatorPlannerResponse([
        {
          content: `VIMLA_OPERATOR_PLANNER_V1\nUSER_REQUEST:\n@Vimla перенеси напоминание на пятницу\nWORKSPACE_SNAPSHOT:\n{"reminders":[]}`,
        },
      ]),
    ) as { intent: string };
    expect(clarify.intent).toBe("clarify");

    const update = JSON.parse(
      mockOperatorPlannerResponse([
        {
          content: `VIMLA_OPERATOR_PLANNER_V1\nUSER_REQUEST:\n@Vimla перенеси напоминание на пятницу\nWORKSPACE_SNAPSHOT:\n{"reminders":[{"id":"11111111-1111-4111-8111-111111111111","title":"Call"}]}`,
        },
      ]),
    ) as { intent: string; commands: Array<{ tool: string }> };
    expect(update.intent).toBe("act");
    expect(update.commands[0]?.tool).toBe("reminders.update");
  });
});
