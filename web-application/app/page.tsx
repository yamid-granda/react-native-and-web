"use client";

import { useState } from "react";
import { Button } from "@rnw/components-library";

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-8 dark:bg-black">
      <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
        react-native-and-web
      </h1>
      <p className="max-w-sm text-center text-zinc-600 dark:text-zinc-400">
        This button is the exact same <code>@rnw/components-library</code> component rendered by
        the Expo app, via react-native-web + NativeWind.
      </p>
      <Button label={`Pressed ${count} times`} onPress={() => setCount((c) => c + 1)} />
    </main>
  );
}
