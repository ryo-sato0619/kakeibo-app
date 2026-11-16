import { useEffect, useState } from 'react';
import { AppProvider } from './state/AppContext.jsx';
import Layout from './components/Layout.jsx';
import { parseHash } from './lib/route.js';
import Home from './screens/Home.jsx';
import History from './screens/History.jsx';
import Accounts from './screens/Accounts.jsx';
import Savings from './screens/Savings.jsx';
import Reports from './screens/Reports.jsx';
import Settings from './screens/Settings.jsx';

const SCREENS = { home: Home, history: History, accounts: Accounts, savings: Savings, reports: Reports, settings: Settings };

function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const Screen = SCREENS[route];
  return (
    <AppProvider>
      <Layout route={route}>
        <Screen />
      </Layout>
    </AppProvider>
  );
}
