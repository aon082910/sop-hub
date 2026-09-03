import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import GuideEditor from "./pages/GuideEditor";
import PublicGuide from "./pages/PublicGuide";
import Settings from "./pages/Settings";
import Layout from "./components/Layout";

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/share/:slug" element={<PublicGuide />} />
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <Register />} />
      <Route
        path="/*"
        element={
          user ? (
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/guides/:id" element={<GuideEditor />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Layout>
          ) : (
            <Navigate to="/login" />
          )
        }
      />
    </Routes>
  );
}
