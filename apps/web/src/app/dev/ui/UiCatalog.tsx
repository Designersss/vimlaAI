"use client";

import { useState, type ReactElement } from "react";
import {
  AIConversationRow,
  Alert,
  AttachmentCard,
  Avatar,
  AvatarGroup,
  Badge,
  BaseListRow,
  BrandLockup,
  Button,
  Card,
  Checkbox,
  ChatComposer,
  ConversationHeader,
  Dialog,
  DirectConversationRow,
  Divider,
  Drawer,
  DropdownMenu,
  DropdownMenuItem,
  EmptyState,
  ErrorState,
  FolderRow,
  FormField,
  Heading,
  IconButton,
  Input,
  MemberAvatarGroup,
  MasterDetailLayout,
  ModelModeControl,
  ModelPickerDialog,
  NativeSelect,
  NoteRow,
  OperatorActionCard,
  OtpInput,
  Pagination,
  PasswordInput,
  PlanLockedBanner,
  PlusIcon,
  Popover,
  Progress,
  ProjectCard,
  ProjectListItem,
  ProjectLocalNav,
  ProjectRow,
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
  Tab,
  Tabs,
  TaskRow,
  Text,
  Textarea,
  Tooltip,
  UsageMeter,
  VimlaMentionChip,
  useAppearance,
  useToast,
} from "@vimla/ui";
import styles from "./catalog.module.scss";

export function UiCatalog(): ReactElement {
  const { appearance, setAppearance } = useAppearance();
  const toast = useToast();
  const [detailOpen, setDetailOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [mode, setMode] = useState<"pro" | "auto">("pro");
  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("demo-1");

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

      <section className={styles.foundationSection} aria-labelledby="foundation-2026-heading">
        <div className={styles.foundationIntro}>
          <Heading as="h2" size="section" id="foundation-2026-heading">
            Design System 2026 foundation
          </Heading>
          <Text tone="secondary">
            Canonical semantic surfaces and type roles. Switch appearance above to verify the same contract in both themes.
          </Text>
        </div>

        <div className={styles.foundationGrid} aria-label="Semantic surface tokens">
          <div className={`${styles.tokenCard} ${styles.surfacePrimary}`}>
            <strong>Background primary</strong>
            <span className={styles.tokenLabel}>--vimla-bg-primary</span>
          </div>
          <div className={`${styles.tokenCard} ${styles.surfaceSecondary}`}>
            <strong>Background secondary</strong>
            <span className={styles.tokenLabel}>--vimla-bg-secondary</span>
          </div>
          <div className={`${styles.tokenCard} ${styles.surfaceOne}`}>
            <strong>Surface 1</strong>
            <span className={styles.tokenLabel}>--vimla-surface-1</span>
          </div>
          <div className={`${styles.tokenCard} ${styles.surfaceTwo}`}>
            <strong>Surface 2</strong>
            <span className={styles.tokenLabel}>--vimla-surface-2</span>
          </div>
          <div className={`${styles.tokenCard} ${styles.surfaceThree}`}>
            <strong>Surface 3</strong>
            <span className={styles.tokenLabel}>--vimla-surface-3</span>
          </div>
          <div className={`${styles.tokenCard} ${styles.accentSurface}`}>
            <strong>Accent soft</strong>
            <span className={styles.tokenLabel}>--vimla-accent-soft / --vimla-accent</span>
          </div>
        </div>

        <div className={styles.typeSpecimen} aria-label="Typography specimen">
          <p className={styles.displaySample}>Think clearer.</p>
          <p className={styles.h1Sample}>A calm, precise interface</p>
          <p className={styles.h2Sample}>Typography carries hierarchy</p>
          <p className={styles.bodySample}>
            Body large is reserved for messages and important reading. Default interface copy remains compact and quiet.
          </p>
          <p className={styles.captionSample}>Caption · 12/16 · semantic secondary context</p>
        </div>

        <div className={styles.statusRow} aria-label="Semantic status colors">
          <span className={`${styles.statusChip} ${styles.successChip}`}>Success</span>
          <span className={`${styles.statusChip} ${styles.warningChip}`}>Warning</span>
          <span className={`${styles.statusChip} ${styles.dangerChip}`}>Danger</span>
        </div>
      </section>

      <section className={styles.stateSection} aria-labelledby="actions-heading">
        <div className={styles.sectionIntro}>
          <Heading as="h2" size="section" id="actions-heading">
            Actions
          </Heading>
          <Text tone="secondary">Variants, sizes, disabled and busy states use the same shared interaction contract.</Text>
        </div>
        <div className={styles.stateGrid} aria-label="Button states">
          <Card>
            <Text weight="semibold">Variants</Text>
            <div className={styles.inlineStates}>
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
          </Card>
          <Card>
            <Text weight="semibold">Size and availability</Text>
            <div className={styles.inlineStates}>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
              <Button loading>Loading</Button>
              <IconButton label="Add" loading>
                <PlusIcon size={16} />
              </IconButton>
            </div>
          </Card>
        </div>
      </section>

      <section className={styles.stateSection} aria-labelledby="forms-heading">
        <div className={styles.sectionIntro}>
          <Heading as="h2" size="section" id="forms-heading">
            Form controls
          </Heading>
          <Text tone="secondary">Labels, descriptions and errors are connected to controls by the shared FormField primitive.</Text>
        </div>
        <div className={styles.formGrid}>
          <FormField label="Email" htmlFor="catalog-email" description="Normal field with supporting text.">
            <Input id="catalog-email" placeholder="name@example.com" />
          </FormField>
          <FormField label="Invalid email" htmlFor="catalog-email-invalid" error="Enter a valid email address.">
            <Input id="catalog-email-invalid" invalid defaultValue="not-an-email" />
          </FormField>
          <FormField label="Read only" htmlFor="catalog-readonly">
            <Input id="catalog-readonly" readOnly value="Shared, non-editable value" />
          </FormField>
          <FormField label="Disabled" htmlFor="catalog-disabled">
            <Input id="catalog-disabled" disabled value="Unavailable" />
          </FormField>
          <FormField label="Select" htmlFor="catalog-select">
            <NativeSelect id="catalog-select" defaultValue="standard">
              <option value="standard">Standard</option>
              <option value="pro">PRO</option>
            </NativeSelect>
          </FormField>
          <FormField label="Password" htmlFor="catalog-password">
            <PasswordInput id="catalog-password" revealLabel="Show" hideLabel="Hide" />
          </FormField>
          <FormField label="Search" htmlFor="catalog-search">
            <SearchInput id="catalog-search" placeholder="Search" />
          </FormField>
          <FormField label="Notes" htmlFor="catalog-notes">
            <Textarea id="catalog-notes" placeholder="Write a note" />
          </FormField>
        </div>
        <div>
          <span id="catalog-otp">OTP</span>
          <OtpInput labelledBy="catalog-otp" value={otp} onChange={setOtp} />
        </div>
        <div className={styles.inlineStates} aria-label="Choice controls">
          <Checkbox label="Checkbox" />
          <Checkbox label="Disabled checkbox" disabled />
          <Radio name="catalog-radio" label="Radio" defaultChecked />
          <Radio name="catalog-radio" label="Disabled radio" disabled />
          <Switch label="Switch" />
          <Switch label="Disabled switch" disabled />
        </div>
      </section>

      <section className={styles.stateSection} aria-labelledby="navigation-heading">
        <div className={styles.sectionIntro}>
          <Heading as="h2" size="section" id="navigation-heading">
            Navigation primitives
          </Heading>
          <Text tone="secondary">Shared navigation controls only; global AppShell migration remains out of scope.</Text>
        </div>
        <Tabs label="Segmented tabs demo">
          <Tab selected onSelect={() => undefined}>
            Active
          </Tab>
          <Tab selected={false} onSelect={() => undefined}>
            Inactive
          </Tab>
          <Tab selected={false} disabled onSelect={() => undefined}>
            Disabled
          </Tab>
        </Tabs>
        <Tabs label="Underline tabs demo" variant="underline">
          <Tab selected onSelect={() => undefined}>
            Overview
          </Tab>
          <Tab selected={false} onSelect={() => undefined}>
            Activity
          </Tab>
        </Tabs>
        <SegmentedControl label="State demo">
          <Segment checked onSelect={() => undefined}>Selected</Segment>
          <Segment checked={false} onSelect={() => undefined}>Idle</Segment>
          <Segment checked={false} disabled onSelect={() => undefined}>Disabled</Segment>
        </SegmentedControl>
      </section>

      <section className={styles.stateSection} aria-labelledby="surfaces-heading">
        <div className={styles.sectionIntro}>
          <Heading as="h2" size="section" id="surfaces-heading">
            Surfaces and feedback
          </Heading>
          <Text tone="secondary">Quiet borders and semantic surfaces provide hierarchy without heavy decoration.</Text>
        </div>
        <div className={styles.stateGrid}>
          <Card>
            <Text weight="semibold">Status and identity</Text>
            <div className={styles.inlineStates}>
              <Badge>Neutral</Badge>
              <Badge variant="accent">PRO</Badge>
              <StatusBadge tone="success">Active</StatusBadge>
              <Avatar name="Ada" />
              <AvatarGroup>
                <Avatar name="Ada" />
                <Avatar name="Ben" />
              </AvatarGroup>
            </div>
          </Card>
          <Card>
            <Text weight="semibold">Progress and loading</Text>
            <Progress value={62} label="Usage" />
            <UsageMeter label="Monthly usage" percent={38} />
            <Skeleton />
            <Spinner label="Loading" />
          </Card>
        </div>
        <Alert>Info</Alert>
        <Alert variant="success">Success</Alert>
        <Alert variant="warning">Warning</Alert>
        <Alert variant="error">Error</Alert>
        <EmptyState title="Empty" description="No items yet." />
        <ErrorState title="Failed" description="Try again." />
        <Divider />
      </section>

      <section className={styles.stateSection} aria-labelledby="overlays-heading">
        <div className={styles.sectionIntro}>
          <Heading as="h2" size="section" id="overlays-heading">
            Overlays
          </Heading>
          <Text tone="secondary">Dialog, drawer, menu, popover, tooltip and toast share viewport-safe surfaces and focus behavior.</Text>
        </div>
        <div className={styles.inlineStates}>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <DropdownMenu label="Open menu">
            <DropdownMenuItem onSelect={() => toast.publish({ title: "Menu action", variant: "success" })}>
              Menu action
            </DropdownMenuItem>
            <DropdownMenuItem disabled onSelect={() => undefined}>
              Disabled action
            </DropdownMenuItem>
          </DropdownMenu>
          <Popover
            open={popoverOpen}
            onOpenChange={setPopoverOpen}
            trigger={
              <Button variant="secondary" size="sm" onClick={() => setPopoverOpen((value) => !value)} aria-expanded={popoverOpen}>
                Popover
              </Button>
            }
          >
            <Text>Popover content</Text>
          </Popover>
          <Tooltip label="Shared tooltip">
            <IconButton label="Tooltip target">
              <PlusIcon size={16} />
            </IconButton>
          </Tooltip>
          <Button variant="secondary" onClick={() => toast.publish({ title: "Saved", variant: "success" })}>
            Toast
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Dialog"
          description="Shared modal."
          closeLabel="Close"
        >
          <Text>Dialog content remains usable in short and narrow viewports.</Text>
        </Dialog>
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Drawer" closeLabel="Close">
          <Text>Navigation sheet</Text>
        </Drawer>
      </section>

      <section>
        <Heading as="h2" size="section">
          Brand / Composer / Model picker (DEMO)
        </Heading>
        <BrandLockup label="Vimla" />
        <VimlaMentionChip label="◆ @Vimla" />
        <ModelModeControl
          mode={mode}
          autoLevel="medium"
          autoEnabled
          selectedModelLabel="Demo model"
          autoLabel="Auto"
          proLabel="PRO"
          minimumLabel="Minimum"
          mediumLabel="Medium"
          maximumLabel="Maximum"
          autoUnavailableHint="Catalog demo only."
          onSelectAuto={() => setMode("auto")}
          onSelectPro={() => {
            setMode("pro");
            setPickerOpen(true);
          }}
        />
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={() => undefined}
          placeholder="Message Vimla"
          sendLabel="Send"
          mentionControl={<Button variant="ghost" size="sm">◆ @Vimla</Button>}
        />
        <OperatorActionCard title="Buy tickets" detail="Tomorrow" statusLabel="Created" tone="success" />
        <OperatorActionCard
          title="Delete task"
          statusLabel="Needs confirmation"
          tone="warning"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
        />
        <ModelPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title="Choose a model"
          searchLabel="Search models"
          allLabel="All"
          streamingLabel="Streaming"
          cancelLabel="Cancel"
          applyLabel="Apply"
          emptyLabel="No models"
          closeLabel="Close"
          selectedId={selectedModel}
          onApply={setSelectedModel}
          models={[
            { id: "demo-1", displayName: "Demo GPT", vendor: "openai", supportsStreaming: true },
            { id: "demo-2", displayName: "Demo Claude", vendor: "anthropic", supportsStreaming: true },
          ]}
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
          <Button size="sm" variant="secondary">Previous</Button>
          <Button size="sm" variant="secondary">Next</Button>
        </Pagination>
      </section>

      <section>
        <Heading as="h2" size="section">
          Future page patterns (DEMO FIXTURES)
        </Heading>
        <Card>
          <ProjectListItem title="DEMO: Brand refresh" meta="Not production data" status={<ProjectStatusBadge status="locked" label="Locked" />} />
          <ProjectCard title="DEMO: Workspace card">
            <MemberAvatarGroup names={["Ada", "Ben"]} />
          </ProjectCard>
          <PlanLockedBanner title="DEMO: Plan locked" description="Presentational only." />
          <ProjectLocalNav label="Project">
            <Button size="sm" variant="ghost">Overview</Button>
            <Button size="sm" variant="ghost">Chats</Button>
            <Button size="sm" variant="ghost">Work</Button>
            <Button size="sm" variant="ghost">Context</Button>
            <Button size="sm" variant="ghost">Members</Button>
          </ProjectLocalNav>
          <AIConversationRow title="DEMO AI conversation" preview="Presentational only" time="10:24" />
          <DirectConversationRow name="DEMO Person" preview="Not production data" time="10:24" />
          <FolderRow title="DEMO folder" meta="Presentational" />
          <NoteRow title="DEMO note" subtitle="Presentational" />
          <ProjectRow title="DEMO project" subtitle="Presentational" members={<MemberAvatarGroup names={["Ada"]} />} />
          <TaskRow title="DEMO task" subtitle="Presentational" />
          <ConversationHeader title="DEMO conversation" />
          <AttachmentCard name="DEMO.pdf" meta="Presentational" />
          <BaseListRow title="DEMO list row" subtitle="Presentational" />
        </Card>
      </section>

      <div>
        <Heading as="h2" size="section">Responsive master-detail (DEMO)</Heading>
        <MasterDetailLayout
          masterLabel="Demo master"
          detailLabel="Demo detail"
          detailOpen={detailOpen}
          master={<AIConversationRow title="DEMO conversation" onSelect={() => setDetailOpen(true)} selected={detailOpen} />}
        >
          <ConversationHeader title="DEMO detail" back={<Button onClick={() => setDetailOpen(false)}>Back to demo list</Button>} />
          <Text>Presentation only. Narrow screens show one pane; wide screens show both.</Text>
        </MasterDetailLayout>
      </div>
    </main>
  );
}
