"use client";

import { createContext } from "react";

// Course subject context — read by BankRow's emoji classifier so we
// don't have to drill the subject prop through 5 layers of components.
export const CourseSubjectContext = createContext<string>("math");
