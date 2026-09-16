import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required. Start PostgreSQL and run `pnpm test:integration`.",
  );
}

describe("orchestration persistence", () => {
  it("persists an additive plan graph and enforces message/attempt idempotency", async () => {
    const client = createPrismaClient(testDatabaseUrl);
    const suffix = randomUUID();
    const userId = `orchestration-user-${suffix}`;
    const email = `orchestration-${suffix}@example.test`;

    let planId: string | undefined;
    let firstInvocationId: string | undefined;
    let secondInvocationId: string | undefined;
    let runId: string | undefined;
    let snapshotId: string | undefined;
    let artifactId: string | undefined;
    let messageId: string | undefined;
    let conversationId: string | undefined;

    try {
      await client.user.create({
        data: {
          id: userId,
          name: "Orchestration Test",
          email,
          emailVerified: true,
        },
      });

      const conversation = await client.conversation.create({
        data: {
          userId,
          title: "Orchestration persistence test",
        },
      });
      conversationId = conversation.id;

      const message = await client.message.create({
        data: {
          conversationId: conversation.id,
          role: "USER",
          content: "Create a prompt and then consume it.",
          status: "COMPLETED",
        },
      });
      messageId = message.id;

      const plan = await client.executionPlan.create({
        data: {
          messageId: message.id,
          userId,
          conversationId: conversation.id,
          schemaVersion: 1,
          version: 1,
          planHash: `sha256:${suffix}`,
          goal: "Persist a two-node orchestration graph",
          status: "PLANNED",
          maxParallelism: 2,
        },
      });
      planId = plan.id;

      await expect(
        client.executionPlan.create({
          data: {
            messageId: message.id,
            userId,
            conversationId: conversation.id,
            schemaVersion: 1,
            version: 1,
            planHash: `sha256:duplicate-${suffix}`,
            goal: "Duplicate plan must fail",
            status: "PLANNED",
            maxParallelism: 1,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      const first = await client.invocation.create({
        data: {
          planId: plan.id,
          sequence: 0,
          purpose: "Produce prompt artifact",
          targetKind: "AI_MODEL",
          targetModelSlug: "gpt",
          outputDeclarations: [{ name: "prompt", artifactType: "PROMPT" }],
          acceptanceCriteria: [],
          riskClass: "READ_ONLY",
          approvalPolicy: "AUTO",
          failurePolicy: "FAIL_PLAN",
          joinPolicy: "ALL_REQUIRED",
          status: "PENDING",
        },
      });
      firstInvocationId = first.id;

      const second = await client.invocation.create({
        data: {
          planId: plan.id,
          sequence: 1,
          purpose: "Consume prompt artifact",
          targetKind: "VIMLA",
          outputDeclarations: [],
          acceptanceCriteria: [],
          riskClass: "INTERNAL_WRITE",
          approvalPolicy: "AUTO",
          failurePolicy: "FAIL_PLAN",
          joinPolicy: "ALL_REQUIRED",
          status: "PENDING",
        },
      });
      secondInvocationId = second.id;

      await client.invocationDependency.create({
        data: {
          planId: plan.id,
          fromInvocationId: first.id,
          toInvocationId: second.id,
          conditionKind: "DATA",
          conditionOutcome: "",
          inputBindings: [
            {
              inputName: "prompt",
              sourceOutputName: "prompt",
              expectedArtifactType: "PROMPT",
            },
          ],
        },
      });

      const run = await client.invocationRun.create({
        data: {
          invocationId: first.id,
          attempt: 1,
          idempotencyKey: `invocation-attempt:${suffix}`,
          status: "COMPLETED",
          outcome: "SUCCESS",
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });
      runId = run.id;

      await expect(
        client.invocationRun.create({
          data: {
            invocationId: second.id,
            attempt: 1,
            idempotencyKey: `invocation-attempt:${suffix}`,
            status: "CREATED",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      const snapshot = await client.contextSnapshot.create({
        data: {
          planId: plan.id,
          version: 1,
          fingerprint: `snapshot:${suffix}`,
        },
      });
      snapshotId = snapshot.id;

      await client.contextSnapshotItem.create({
        data: {
          snapshotId: snapshot.id,
          sequence: 0,
          sourceType: "MESSAGE",
          sourceId: message.id,
          sourceVersion: "1",
          fingerprint: `message:${suffix}`,
          classification: "PRIVATE",
        },
      });

      await client.contextBundle.create({
        data: {
          invocationId: first.id,
          snapshotId: snapshot.id,
          fingerprint: `bundle:${suffix}`,
          manifest: {
            snapshotItemSequences: [0],
            dependencyArtifactIds: [],
          },
        },
      });

      const artifact = await client.artifact.create({
        data: {
          creatorInvocationId: first.id,
          outputName: "prompt",
          type: "PROMPT",
          classification: "PRIVATE",
        },
      });
      artifactId = artifact.id;

      await client.artifactVersion.create({
        data: {
          artifactId: artifact.id,
          version: 1,
          contentJson: { text: "A frozen prompt artifact" },
          fingerprint: `artifact:${suffix}`,
        },
      });

      await client.artifactAccessGrant.create({
        data: {
          artifactId: artifact.id,
          granteeUserId: userId,
          permission: "READ",
        },
      });

      await client.evaluation.create({
        data: {
          invocationRunId: run.id,
          evaluatorKind: "DETERMINISTIC",
          outcome: "PASS",
          criteriaResults: [],
        },
      });

      const persisted = await client.executionPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: {
          invocations: true,
          dependencies: true,
          contextSnapshot: {
            include: { items: true, bundles: true },
          },
        },
      });

      expect(persisted.invocations).toHaveLength(2);
      expect(persisted.dependencies).toHaveLength(1);
      expect(persisted.contextSnapshot?.items).toHaveLength(1);
      expect(persisted.contextSnapshot?.bundles).toHaveLength(1);
    } finally {
      if (runId) {
        await client.evaluation.deleteMany({ where: { invocationRunId: runId } });
      }
      if (artifactId) {
        await client.artifactAccessGrant.deleteMany({ where: { artifactId } });
        await client.artifactVersion.deleteMany({ where: { artifactId } });
        await client.artifact.deleteMany({ where: { id: artifactId } });
      }
      if (snapshotId) {
        await client.contextBundle.deleteMany({ where: { snapshotId } });
        await client.contextSnapshotItem.deleteMany({ where: { snapshotId } });
        await client.contextSnapshot.deleteMany({ where: { id: snapshotId } });
      }
      if (runId) {
        await client.invocationRun.deleteMany({ where: { id: runId } });
      }
      if (planId) {
        await client.invocationDependency.deleteMany({ where: { planId } });
      }
      if (firstInvocationId || secondInvocationId) {
        await client.invocation.deleteMany({
          where: {
            id: {
              in: [firstInvocationId, secondInvocationId].filter(
                (value): value is string => Boolean(value),
              ),
            },
          },
        });
      }
      if (planId) {
        await client.executionPlan.deleteMany({ where: { id: planId } });
      }
      if (messageId) {
        await client.message.deleteMany({ where: { id: messageId } });
      }
      if (conversationId) {
        await client.conversation.deleteMany({ where: { id: conversationId } });
      }
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });
});
