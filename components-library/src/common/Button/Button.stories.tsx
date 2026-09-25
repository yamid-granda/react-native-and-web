import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "common/Button",
  component: Button,
  args: {
    label: "Press me",
  },
};

export default meta;

type Story = StoryObj<typeof Button>;

export const Default: Story = {};
