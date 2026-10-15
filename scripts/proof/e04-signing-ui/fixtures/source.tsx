import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {HelmetProvider} from 'react-helmet-async';
import AgreementSigning from '../../../../src/pages/sign/AgreementSigning';
import {fixture} from './sdk';
const router=createMemoryRouter([{path:'/sign/:token',element:<AgreementSigning/>}],{initialEntries:['/sign/'+fixture.token]});
fixture.navigate=async(token:string,mode:string)=>{fixture.mode=mode;await router.navigate('/sign/'+token);};
createRoot(document.getElementById('root')!).render(<HelmetProvider><RouterProvider router={router}/></HelmetProvider>);
