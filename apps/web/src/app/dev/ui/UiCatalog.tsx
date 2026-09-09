"use client";

import { useState, type ReactElement } from "react";
import {
  AiModeSelector,
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Divider,
  Drawer,
  EmptyState,
  ErrorState,
  FormField,
  Heading,
  IconButton,
  Input,
  MemberAvatarGroup,
  OtpInput,
  Pagination,
  PasswordInput,
  PlanLockedBanner,
  Progress,
  ProjectCard,
  ProjectListItem,
  ProjectStatusBadge,
  Radio,
  SearchInput,
  Segment,
  SegmentedControl,
  Skeleton,
  Spinner,
  StatusBadge,
  Switch,
  Table,
  Tabs,
  Tab,
  Text,
  Textarea,
  UsageMeter,
  useAppearance,
  useToast,
  ChatComposer,
  PlusIcon,
} from "@vimla/ui";

export function UiCatalog(): ReactElement {
  const { appearance, setAppearance } = useAppearance();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [mode, setMode] = useState<"pro" | "auto">("pro");
  const [draft, setDraft] = useState("");

  return (
    <main>
      <Heading as="h1" size="page">
        Vimla UI catalog
      </Heading>
      <Text tone="secondary">Local/test only. Demo fixtures below are not production data.</Text>

      <section>
        <Heading as="h2" size="section">
          Appearance
        </Heading>
        <SegmentedControl label="Appearance">
          <Segment checked={appearance === "light"} onSelect={() => setAppearance("light")}>
            Light
          </Segment>
          <Segment checked={appearance === "dark"} onSelect={() => setAppearance("dark")}>
            Dark
          </Segment>
          <Segment checked={appearance === "system"} onSelect={() => setAppearance("system")}>
            System
          </Segment>
        </SegmentedControl>
      </section>

      <section>
        <Heading as="h2" size="section">
          Buttons
        </Heading>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button loading>Loading</Button>
        <IconButton label="Add">
          <PlusIcon size={16} />
        </IconButton>
      </section>

      <section>
        <Heading as="h2" size="section">
          Forms
        </Heading>
        <FormField label="Email" htmlFor="catalog-email">
          <Input id="catalog-email" />
        </FormField>
        <FormField label="Password" htmlFor="catalog-password">
          <PasswordInput id="catalog-password" revealLabel="Show" hideLabel="Hide" />
        </FormField>
        <SearchInput aria-label="Search" />
        <Textarea aria-label="Notes" />
        <div>
          <span id="catalog-otp">OTP</span>
          <OtpInput labelledBy="catalog-otp" value={otp} onChange={setOtp} />
        </div>
        <Checkbox label="Checkbox" />
        <Radio name="catalog-radio" label="Radio" defaultChecked />
        <Switch label="Switch" />
      </section>

      <section>
        <Heading as="h2" size="section">
          Feedback
        </Heading>
        <Alert>Info</Alert>
        <Alert variant="success">Success</Alert>
        <Alert variant="warning">Warning</Alert>
        <Alert variant="error">Error</Alert>
        <Badge>Neutral</Badge>
        <Badge variant="accent">PRO</Badge>
        <StatusBadge tone="success">Active</StatusBadge>
        <Avatar name="Ada" />
        <AvatarGroup>
          <Avatar name="Ada" />
          <Avatar name="Ben" />
        </AvatarGroup>
        <Progress value={62} label="Usage" />
        <UsageMeter label="Monthly usage" percent={38} />
        <Skeleton />
        <Spinner label="Loading" />
        <EmptyState title="Empty" description="No items yet." />
        <ErrorState title="Failed" description="Try again." />
        <Divider />
      </section>

      <section>
        <Heading as="h2" size="section">
          Overlays
        </Heading>
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
          Open drawer
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.publish({ title: "Saved", variant: "success" })}
        >
          Toast
        </Button>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Dialog"
          description="Shared modal."
          closeLabel="Close"
        />
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Drawer" closeLabel="Close">
          <Text>Navigation sheet</Text>
        </Drawer>
      </section>

      <section>
        <Heading as="h2" size="section">
          AUTO / PRO
        </Heading>
        <AiModeSelector
          mode={mode}
          onModeChange={setMode}
          label="Mode"
          proLabel="PRO"
          autoLabel="AUTO"
          autoEnabled
          autoHint="Catalog demo only. AUTO does not reveal a hidden model."
        />
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={() => undefined}
          placeholder="Message Vimla"
          sendLabel="Send"
        />
      </section>

      <section>
        <Heading as="h2" size="section">
          Table
        </Heading>
        <Table caption="Demo table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Demo row</td>
              <td>Ready</td>
            </tr>
          </tbody>
        </Table>
        <Pagination>
          <Button size="sm" variant="secondary">
            Previous
          </Button>
          <Button size="sm" variant="secondary">
            Next
          </Button>
        </Pagination>
      </section>

      <section>
        <Heading as="h2" size="section">
          Future project primitives (DEMO FIXTURES)
        </Heading>
        <Card>
          <ProjectListItem
            title="DEMO: Brand refresh"
            meta="Not production data"
            status={<ProjectStatusBadge status="locked" label="Locked" />}
          />
          <ProjectCard title="DEMO: Workspace card">
            <MemberAvatarGroup names={["Ada", "Ben"]} />
          </ProjectCard>
          <PlanLockedBanner title="DEMO: Plan locked" description="Presentational only." />
        </Card>
      </section>

      <Tabs label="Tabs demo">
        <Tab selected onSelect={() => undefined}>
          One
        </Tab>
        <Tab selected={false} onSelect={() => undefined}>
          Two
        </Tab>
      </Tabs>
    </main>
  );
}
