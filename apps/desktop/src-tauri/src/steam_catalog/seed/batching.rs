/// Acumulador acotado para agrupar resultados antes de persistirlos.
pub struct BatchAccumulator<T> {
    items: Vec<T>,
    batches: usize,
    max_items: usize,
    max_batches: usize,
}

impl<T> BatchAccumulator<T> {
    /// Crea un acumulador con límites de filas y batches de origen.
    pub fn new(max_items: usize, max_batches: usize) -> Self {
        Self {
            items: Vec::with_capacity(max_items),
            batches: 0,
            max_items: max_items.max(1),
            max_batches: max_batches.max(1),
        }
    }

    /// Añade las filas de un batch al grupo actual.
    pub fn push_batch<I>(&mut self, items: I)
    where
        I: IntoIterator<Item = T>,
    {
        self.items.extend(items);
        self.batches += 1;
    }

    /// Indica si el grupo alcanzó alguno de sus límites.
    pub fn should_flush(&self) -> bool {
        self.items.len() >= self.max_items || self.batches >= self.max_batches
    }

    /// Indica si el grupo no contiene filas.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Devuelve las filas acumuladas y reinicia el grupo.
    pub fn take(&mut self) -> Vec<T> {
        self.batches = 0;
        std::mem::replace(&mut self.items, Vec::with_capacity(self.max_items))
    }
}

#[cfg(test)]
mod tests {
    use super::BatchAccumulator;

    #[test]
    fn should_flush_when_item_limit_is_reached() {
        let mut accumulator = BatchAccumulator::new(2, 10);
        accumulator.push_batch([1, 2]);

        assert!(accumulator.should_flush());
    }

    #[test]
    fn should_flush_when_batch_limit_is_reached() {
        let mut accumulator = BatchAccumulator::new(10, 2);
        accumulator.push_batch([1]);
        accumulator.push_batch([2]);

        assert!(accumulator.should_flush());
    }

    #[test]
    fn take_should_return_items_and_reset_batch_count() {
        let mut accumulator = BatchAccumulator::new(10, 2);
        accumulator.push_batch([1, 2]);

        assert_eq!(accumulator.take(), vec![1, 2]);
        assert!(accumulator.is_empty());

        accumulator.push_batch([3]);
        assert!(!accumulator.should_flush());
    }
}
