import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { KaTeXView } from "./src/components/KaTeXView";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Math Teacher</Text>
      <KaTeXView latex="2x + 6 = 12" displayMode />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
});
