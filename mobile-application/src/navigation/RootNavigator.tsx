import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "@rnw/components-library";

export type RootStackParamList = {
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * React Navigation lives only here, inside mobile-application. Next.js App
 * Router owns all web routing — only screen/page *content* (built from
 * shared components-library primitives) is shared between the two apps,
 * not navigation chrome.
 */
export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "react-native-and-web" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
