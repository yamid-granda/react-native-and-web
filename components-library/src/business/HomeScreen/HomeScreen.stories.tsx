import type { Meta, StoryObj } from "@storybook/react";
import { HomeScreen } from "./HomeScreen";

const meta: Meta<typeof HomeScreen> = {
  title: "business/HomeScreen",
  component: HomeScreen,
};

export default meta;

type Story = StoryObj<typeof HomeScreen>;

export const Default: Story = {};
