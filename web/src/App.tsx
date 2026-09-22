import { Route, Routes } from 'react-router';

export default function App() {
  return (
    <Routes>
      <Route path="/runs/:id" element={<div className="p-4">Run detail placeholder</div>} />
      <Route path="*" element={<div className="p-4">agent-xray placeholder</div>} />
    </Routes>
  );
}
