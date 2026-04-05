import { Modal } from "@mantine/core";
import { type Connection } from "../../connections";
import { ConnectionForm } from "./ConnectionForm";

type ConnectionModalProps = {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connection?: Connection;
};

export function ConnectionModal({
  opened,
  onClose,
  onSuccess,
  connection,
}: ConnectionModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={connection ? "Edit Connection" : "New Connection"}
      centered
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 3,
      }}
    >
      <ConnectionForm connection={connection} onSuccess={onSuccess} />
    </Modal>
  );
}
