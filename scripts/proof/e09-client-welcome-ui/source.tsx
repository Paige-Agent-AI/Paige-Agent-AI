import {createRoot} from "react-dom/client";
import {MemoryRouter,Route,Routes,useNavigate} from "react-router-dom";
import OnboardLayout from "@/pages/onboard/OnboardLayout";
import Step1Welcome from "@/pages/onboard/Step1Welcome";
function AgreementExit(){const navigate=useNavigate();return <div className="onboard-card p-6"><p>Agreement route test double</p>
  <button onClick={()=>navigate("/onboard/welcome")}>Return to information</button></div>;}
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/onboard/welcome"]}><Routes>
  <Route element={<OnboardLayout/>}><Route path="/onboard/welcome" element={<Step1Welcome/>}/>
    <Route path="/onboard/agreement" element={<AgreementExit/>}/></Route>
  <Route path="/app" element={<p>Workspace route test double</p>}/>
</Routes></MemoryRouter>);
