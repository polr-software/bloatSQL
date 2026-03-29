import { memo } from "react";
import { Box } from "@mantine/core";
import styles from "./Footer.module.css";
import { FooterControls } from "./FooterControls";
import { FooterPanel } from "./FooterPanel";

function FooterComponent() {
  return (
    <Box className={styles.footer}>
      <FooterControls />
      <FooterPanel />
    </Box>
  );
}

export const Footer = memo(FooterComponent);
